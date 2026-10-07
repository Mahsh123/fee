import { divRound, Money, MONEY_UNITS_PER_MAJOR, parseDecimalToUnits } from '@fee/money';
import { type FeeBaseCalculationSnapshot, type FeeCalculationConfig, type FeeCalculationMethod, type FeeContext } from '@fee/types';

const MAX_AMOUNT_UNITS = 999_999_999_999_999_999n;
const MAX_EXPRESSION_LENGTH = 512;
const MAX_EXPRESSION_TOKENS = 128;
const MAX_EXPRESSION_DEPTH = 24;
const NUMBER_FACTS = new Set(['student.academicScore']);
const STRUCTURE_FACTS = new Set(['fee.amount', 'fee.quantity', 'fee.percentBase']);

type Expression =
  | { kind: 'constant'; value: string }
  | { kind: 'fact'; path: string }
  | { kind: 'negate'; value: Expression }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: Expression; right: Expression };

export class FeeBaseCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeBaseCalculationError';
  }
}

export interface CalculateBaseAmountInput {
  method: FeeCalculationMethod;
  amount: string;
  quantity?: string | null;
  percentBase?: string | null;
  config?: unknown;
  context: FeeContext;
  currency: string;
}

export function validateFeeCalculationConfig(method: FeeCalculationMethod, input: unknown): FeeCalculationConfig | null {
  if (input === undefined || input === null) {
    if (method === 'USAGE' || method === 'FORMULA' || method === 'CUSTOM') {
      throw new FeeBaseCalculationError(`${method} fee types require a calculation configuration before publication.`);
    }
    return null;
  }
  if (!isRecord(input) || input.schemaVersion !== 1 || typeof input.kind !== 'string') {
    throw new FeeBaseCalculationError('Calculation configuration must use the supported schema version.');
  }
  if (method === 'USAGE') {
    if (input.kind !== 'USAGE' || typeof input.quantityPath !== 'string' || !isAllowedFactPath(input.quantityPath)) {
      throw new FeeBaseCalculationError('Choose a supported numeric student or history field for the usage quantity.');
    }
    return { schemaVersion: 1, kind: 'USAGE', quantityPath: input.quantityPath };
  }
  if (method === 'FORMULA' || method === 'CUSTOM') {
    if (input.kind !== method || typeof input.expression !== 'string') {
      throw new FeeBaseCalculationError(`${method} needs a matching calculation expression.`);
    }
    parseExpression(input.expression);
    return { schemaVersion: 1, kind: method, expression: input.expression.trim() };
  }
  throw new FeeBaseCalculationError(`${method} does not accept a custom calculation configuration.`);
}

export function calculateBaseAmount(input: CalculateBaseAmountInput): FeeBaseCalculationSnapshot {
  const config = validateFeeCalculationConfig(input.method, input.config);
  const resolvedInputs: Record<string, string> = {};
  let units: bigint;
  switch (input.method) {
    case 'FIXED':
      units = parseAmount(input.amount, input.currency);
      break;
    case 'QUANTITY': {
      if (input.quantity === null || input.quantity === undefined) throw new FeeBaseCalculationError('A quantity fee requires a configured quantity for each fee structure item.');
      const rateUnits = parseAmount(input.amount, input.currency);
      const quantityUnits = parseNumeric(input.quantity, 'fee.quantity');
      resolvedInputs['fee.amount'] = input.amount;
      resolvedInputs['fee.quantity'] = input.quantity;
      units = checked(divRound(rateUnits * quantityUnits, MONEY_UNITS_PER_MAJOR));
      break;
    }
    case 'PERCENTAGE': {
      if (input.percentBase === null || input.percentBase === undefined) throw new FeeBaseCalculationError('A percentage fee requires a configured percentage base.');
      const base = Money.fromString(input.percentBase, input.currency);
      resolvedInputs['fee.percentBase'] = input.percentBase;
      resolvedInputs['fee.amount'] = input.amount;
      units = base.percent(input.amount).units;
      break;
    }
    case 'USAGE': {
      const usage = config as Extract<FeeCalculationConfig, { kind: 'USAGE' }>;
      const quantity = resolveNumericFact(input.context, usage.quantityPath);
      resolvedInputs[usage.quantityPath] = quantity.toString();
      resolvedInputs['fee.amount'] = input.amount;
      units = checked(divRound(parseAmount(input.amount, input.currency) * quantity, MONEY_UNITS_PER_MAJOR));
      break;
    }
    case 'FORMULA':
    case 'CUSTOM': {
      const expressionConfig = config as Extract<FeeCalculationConfig, { kind: 'FORMULA' | 'CUSTOM' }>;
      const feeContext = {
        ...input.context,
        fee: {
          ...input.context.fee,
          amount: input.amount,
          quantity: input.quantity ?? undefined,
          percentBase: input.percentBase ?? undefined,
        },
      };
      const expression = parseExpression(expressionConfig.expression);
      units = evaluate(expression, feeContext, input.currency, resolvedInputs, 0);
      break;
    }
    default:
      return assertNever(input.method);
  }
  if (units < 0n) throw new FeeBaseCalculationError('A base fee calculation cannot produce a negative amount. Use a configured relief or adjustment for reductions.');
  const amount = Money.fromUnits(checked(units), input.currency).toString();
  return { method: input.method, config, resolvedInputs, amount };
}

function parseExpression(source: string): Expression {
  if (!source.trim() || source.length > MAX_EXPRESSION_LENGTH) throw new FeeBaseCalculationError('Enter a calculation expression up to 512 characters.');
  const tokens = tokenize(source);
  if (tokens.length > MAX_EXPRESSION_TOKENS) throw new FeeBaseCalculationError('Calculation expressions may contain at most 128 tokens.');
  let cursor = 0;
  let nodeCount = 0;
  const node = <T extends Expression>(value: T): T => {
    nodeCount += 1;
    if (nodeCount > MAX_EXPRESSION_TOKENS) throw new FeeBaseCalculationError('Calculation expressions are too complex.');
    return value;
  };
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];

  const primary = (depth: number): Expression => {
    if (depth > MAX_EXPRESSION_DEPTH) throw new FeeBaseCalculationError('Calculation expressions cannot be nested more than 24 levels.');
    const token = take();
    if (token === undefined) throw new FeeBaseCalculationError('The calculation expression ends unexpectedly.');
    if (token === '-') return node({ kind: 'negate', value: primary(depth + 1) });
    if (token === '+') return primary(depth + 1);
    if (token === '(') {
      const expression = add(depth + 1);
      if (take() !== ')') throw new FeeBaseCalculationError('Close every opening parenthesis in the calculation expression.');
      return expression;
    }
    if (/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(token)) {
      parseNumeric(token, 'formula constant');
      return node({ kind: 'constant', value: token });
    }
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(token)) {
      if (!isAllowedFactPath(token)) throw new FeeBaseCalculationError(`The calculation field “${token}” is not an available numeric fee fact.`);
      return node({ kind: 'fact', path: token });
    }
    throw new FeeBaseCalculationError(`Unexpected token “${token}” in the calculation expression.`);
  };

  const product = (depth: number): Expression => {
    let left = primary(depth);
    while (peek() === '*' || peek() === '/') {
      const operator = take() as '*' | '/';
      const right = primary(depth);
      left = node({ kind: 'binary', operator, left, right });
    }
    return left;
  };

  const add = (depth: number): Expression => {
    let left = product(depth);
    while (peek() === '+' || peek() === '-') {
      const operator = take() as '+' | '-';
      const right = product(depth);
      left = node({ kind: 'binary', operator, left, right });
    }
    return left;
  };

  const expression = add(0);
  if (cursor !== tokens.length) throw new FeeBaseCalculationError(`Unexpected token “${tokens[cursor]}” in the calculation expression.`);
  if (expressionDepth(expression) > MAX_EXPRESSION_DEPTH) throw new FeeBaseCalculationError('Calculation expression nesting exceeds the safe 24-level limit.');
  return expression;
}

function expressionDepth(expression: Expression): number {
  if (expression.kind === 'constant' || expression.kind === 'fact') return 1;
  if (expression.kind === 'negate') return 1 + expressionDepth(expression.value);
  return 1 + Math.max(expressionDepth(expression.left), expressionDepth(expression.right));
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*([A-Za-z_][A-Za-z0-9_.]*|(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/])/y;
  let cursor = 0;
  while (cursor < source.length) {
    if (source.slice(cursor).trim().length === 0) break;
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) throw new FeeBaseCalculationError(`Unsupported character at position ${cursor + 1}. Use numbers, fee fields, and + - * / with parentheses.`);
    tokens.push(match[1]!);
    cursor = pattern.lastIndex;
    if (tokens.length > MAX_EXPRESSION_TOKENS) throw new FeeBaseCalculationError('Calculation expressions may contain at most 128 tokens.');
  }
  return tokens;
}

function evaluate(expression: Expression, context: FeeContext, currency: string, resolved: Record<string, string>, depth: number): bigint {
  if (depth > MAX_EXPRESSION_DEPTH) throw new FeeBaseCalculationError('Calculation expression depth exceeded the safe limit.');
  switch (expression.kind) {
    case 'constant': return parseNumeric(expression.value, 'formula constant');
    case 'fact': {
      const value = resolveNumericFact(context, expression.path);
      resolved[expression.path] = Money.fromUnits(value, currency).toString();
      return value;
    }
    case 'negate': return checked(-evaluate(expression.value, context, currency, resolved, depth + 1));
    case 'binary': {
      const left = evaluate(expression.left, context, currency, resolved, depth + 1);
      const right = evaluate(expression.right, context, currency, resolved, depth + 1);
      switch (expression.operator) {
        case '+': return checked(left + right);
        case '-': return checked(left - right);
        case '*': return checked(divRound(left * right, MONEY_UNITS_PER_MAJOR));
        case '/':
          if (right === 0n) throw new FeeBaseCalculationError('The calculation expression divides by zero.');
          return checked(divRound(left * MONEY_UNITS_PER_MAJOR, right));
      }
    }
  }
  throw new FeeBaseCalculationError('The calculation expression contains an unsupported operation.');
}

function resolveNumericFact(context: FeeContext, path: string): bigint {
  if (!isAllowedFactPath(path)) throw new FeeBaseCalculationError(`The calculation field “${path}” is not available.`);
  let value: unknown = context;
  for (const part of path.split('.')) {
    if (!isRecord(value) || !Object.hasOwn(value, part)) throw new FeeBaseCalculationError(`The calculation field “${path}” is not available for this student.`);
    value = value[part];
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new FeeBaseCalculationError(`The calculation field “${path}” has no numeric value for this student.`);
  return parseNumeric(String(value), path);
}

function isAllowedFactPath(path: string): boolean {
  if (STRUCTURE_FACTS.has(path) || NUMBER_FACTS.has(path)) return true;
  return /^student\.customAttributes\.[A-Za-z][A-Za-z0-9_]{0,63}$/.test(path);
}

function parseAmount(value: string, currency: string): bigint {
  try {
    return checked(Money.fromString(value, currency).units);
  } catch {
    throw new FeeBaseCalculationError('The configured fee amount is not a valid supported decimal.');
  }
}

function parseNumeric(value: string, label: string): bigint {
  if (!/^-?(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(value)) throw new FeeBaseCalculationError(`The ${label} value must be numeric with at most four decimal places.`);
  try {
    return checked(parseDecimalToUnits(value));
  } catch {
    throw new FeeBaseCalculationError(`The ${label} value is outside the supported range.`);
  }
}

function checked(value: bigint): bigint {
  if (value > MAX_AMOUNT_UNITS || value < -MAX_AMOUNT_UNITS) throw new FeeBaseCalculationError('The calculated amount exceeds the supported financial range.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new FeeBaseCalculationError(`Unsupported fee calculation method: ${String(value)}`);
}
