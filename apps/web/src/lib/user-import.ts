export interface ImportRole { id: string; key: string; active: boolean }
export interface ImportBranch { id: string; code: string; status: string }
export interface ImportUnit { id: string; code: string; active: boolean }
export interface ImportUserRow {
  line: number;
  email: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  roleIds: string[];
  branchIds: string[];
  organizationUnitIds: string[];
  errors: string[];
}

export function buildImportPreview(text: string, roles: ImportRole[], branches: ImportBranch[], units: ImportUnit[]): { rows: ImportUserRow[]; globalError: string } {
  if (!text.trim()) return { rows: [], globalError: '' };
  let records: string[][];
  try { records = parseCsv(text); }
  catch { return { rows: [], globalError: 'The CSV has an unclosed quote or invalid row formatting.' }; }
  const nonEmpty = records.filter((record) => record.some((cell) => cell.trim()));
  if (nonEmpty.length < 2) return { rows: [], globalError: 'Add a header row and at least one user.' };
  const headers = nonEmpty[0]!.map((header) => header.trim().replace(/^\uFEFF/, '').toLowerCase());
  if (new Set(headers).size !== headers.length) return { rows: [], globalError: 'Each CSV column name must be unique.' };
  const required = ['firstname', 'email', 'rolekeys', 'branchcodes'];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) return { rows: [], globalError: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` };
  const sourceRows = nonEmpty.slice(1);
  if (sourceRows.length > 100) return { rows: [], globalError: 'Import up to 100 users at a time. Split this file into smaller batches.' };
  const column = (cells: string[], key: string) => {
    const index = headers.indexOf(key.toLowerCase());
    return index < 0 ? '' : (cells[index] ?? '').trim();
  };
  const splitKeys = (value: string) => [...new Set(value.split('|').map((part) => part.trim()).filter(Boolean))];
  const roleByKey = new Map(roles.filter((role) => role.active).map((role) => [role.key.toUpperCase(), role]));
  const branchByCode = new Map(branches.filter((branch) => branch.status === 'ACTIVE').map((branch) => [branch.code.toUpperCase(), branch]));
  const unitByCode = new Map(units.filter((unit) => unit.active).map((unit) => [unit.code.toUpperCase(), unit]));
  const rows = sourceRows.map((cells, index): ImportUserRow => {
    const firstName = column(cells, 'firstName');
    const lastName = column(cells, 'lastName') || null;
    const email = column(cells, 'email').toLowerCase();
    const phone = column(cells, 'phone') || null;
    const errors: string[] = [];
    if (!firstName) errors.push('First name required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email required');
    const roleKeys = splitKeys(column(cells, 'roleKeys')).map((key) => key.toUpperCase());
    const rowRoles = roleKeys.map((key) => roleByKey.get(key)).filter((role): role is ImportRole => Boolean(role));
    if (!roleKeys.length) errors.push('Choose a role');
    if (rowRoles.length !== roleKeys.length) errors.push('Unknown or inactive role key');
    if (roleKeys.some((key) => key === 'STUDENT' || key === 'PARENT')) errors.push('Portal roles must be linked individually');
    const branchCodes = splitKeys(column(cells, 'branchCodes')).map((code) => code.toUpperCase());
    const rowBranches = branchCodes.map((code) => branchByCode.get(code)).filter((branch): branch is ImportBranch => Boolean(branch));
    if (!branchCodes.length) errors.push('Choose at least one branch');
    if (rowBranches.length !== branchCodes.length) errors.push('Unknown or inactive branch code');
    const unitCodes = splitKeys(column(cells, 'organizationUnitCodes')).map((code) => code.toUpperCase());
    const rowUnits = unitCodes.map((code) => unitByCode.get(code)).filter((unit): unit is ImportUnit => Boolean(unit));
    if (rowUnits.length !== unitCodes.length) errors.push('Unknown or inactive group code');
    return {
      line: index + 2, email, firstName, lastName, phone,
      roleIds: rowRoles.map((role) => role.id), branchIds: rowBranches.map((branch) => branch.id), organizationUnitIds: rowUnits.map((unit) => unit.id), errors,
    };
  });
  const emailRows = new Map<string, ImportUserRow[]>();
  for (const row of rows) if (row.email) emailRows.set(row.email, [...(emailRows.get(row.email) ?? []), row]);
  for (const duplicates of emailRows.values()) if (duplicates.length > 1) for (const row of duplicates) row.errors.push('Duplicate email in file');
  return { rows, globalError: '' };
}

function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('unclosed CSV field');
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.length) || rows.length === 0) rows.push(row);
  return rows;
}
