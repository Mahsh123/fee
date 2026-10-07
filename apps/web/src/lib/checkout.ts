export interface CheckoutSession {
  mode?: string;
  url?: string;
  fields?: Record<string, string>;
  keyId?: string;
  orderId?: string;
  amount?: string;
  currency?: string;
  paymentSessionId?: string;
  environment?: string;
  callbackUrl?: string;
}

export async function launchCheckout(checkout: CheckoutSession, orderNumber: string): Promise<void> {
  if (checkout.mode === 'REDIRECT' && checkout.url) { window.location.assign(checkout.url); return; }
  if (checkout.mode === 'FORM_POST' && checkout.url && checkout.fields) {
    const form = document.createElement('form'); form.method = 'POST'; form.action = checkout.url;
    for (const [name, value] of Object.entries(checkout.fields)) { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input); }
    document.body.append(form); form.submit(); return;
  }
  if (checkout.mode === 'RAZORPAY' && checkout.keyId && checkout.orderId && checkout.amount && checkout.currency) {
    await loadCheckoutScript('https://checkout.razorpay.com/v1/checkout.js');
    const Razorpay = (window as Window & { Razorpay?: new (options: Record<string, unknown>) => { open(): void } }).Razorpay;
    if (!Razorpay) throw new Error('The Razorpay checkout SDK did not load. Try again.');
    new Razorpay({ key: checkout.keyId, order_id: checkout.orderId, amount: checkout.amount, currency: checkout.currency, name: 'Fee payment', description: orderNumber, callback_url: checkout.callbackUrl, redirect: Boolean(checkout.callbackUrl), modal: { ondismiss: () => undefined } }).open(); return;
  }
  if (checkout.mode === 'CASHFREE' && checkout.paymentSessionId) {
    await loadCheckoutScript('https://sdk.cashfree.com/js/v3/cashfree.js');
    const cashfree = (window as Window & { Cashfree?: (options: { mode: string }) => { checkout(options: { paymentSessionId: string; redirectTarget: string }): Promise<unknown> } }).Cashfree;
    if (!cashfree) throw new Error('The Cashfree checkout SDK did not load. Try again.');
    const cashfreeMode = cashfree({ mode: checkout.environment === 'LIVE' ? 'production' : 'sandbox' });
    await cashfreeMode.checkout({ paymentSessionId: checkout.paymentSessionId, redirectTarget: '_self' }); return;
  }
  if (checkout.mode === 'MOCK') throw new Error('The test gateway is configured, but its capture simulator is unavailable.');
  throw new Error('This provider returned an unsupported checkout format.');
}

function loadCheckoutScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === 'true') { resolve(); return; }
    const script = existing ?? document.createElement('script');
    script.src = src; script.async = true;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error('The payment provider checkout script could not be loaded.'));
    if (!existing) document.head.append(script);
  });
}
