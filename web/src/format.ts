const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const int = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

export const fmtMoney = (cents: number) => usd2.format(cents / 100);
export const fmtMoneyWhole = (cents: number) => usd0.format(cents / 100);
export const fmtMoneyCompact = (cents: number) => '$' + compact.format(cents / 100);
export const fmtInt = (n: number) => int.format(n);
export const fmtMs = (ms: number) => (ms < 10 ? ms.toFixed(1) : Math.round(ms).toString()) + ' ms';
export const fmtMB = (bytes: number) => (bytes / 1048576).toFixed(0) + ' MB';
export const fmtRecordId = (id: number) => 'SYN-' + String(id).padStart(8, '0');
export const maskedSsn = (last4: string) => `***-**-${last4}`;
