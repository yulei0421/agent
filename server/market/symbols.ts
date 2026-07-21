export interface NormalizedSymbol {
  canonical: string;
  market: 'crypto' | 'cn' | 'hk' | 'us';
  providerSymbol: string;
}

function invalidSymbol(input: unknown): never {
  throw new Error(`Invalid market symbol: ${String(input)}`);
}

export function normalizeSymbol(input: unknown): NormalizedSymbol {
  if (typeof input !== 'string') {
    return invalidSymbol(input);
  }

  const symbol = input.trim().toUpperCase();
  const cryptoMatch = symbol.match(/^([A-Z0-9]{2,15})\/([A-Z0-9]{2,15})$/);
  if (cryptoMatch) {
    const [, base, quote] = cryptoMatch;
    return {
      canonical: `${base}/${quote}`,
      market: 'crypto',
      providerSymbol: `${base}${quote}`
    };
  }

  const cnMatch = symbol.match(/^(\d{6})\.(SH|SS|SZ)$/);
  if (cnMatch) {
    const [, code, suffix] = cnMatch;
    const isShanghai = suffix === 'SH' || suffix === 'SS';
    return {
      canonical: `${code}.${isShanghai ? 'SH' : 'SZ'}`,
      market: 'cn',
      providerSymbol: `${code}.${isShanghai ? 'SS' : 'SZ'}`
    };
  }

  const hkMatch = symbol.match(/^(\d{4,5})\.HK$/);
  if (hkMatch) {
    const code = hkMatch[1];
    if (!code) return invalidSymbol(input);
    return {
      canonical: `${code}.HK`,
      market: 'hk',
      providerSymbol: `${code}.HK`
    };
  }

  const usMatch = symbol.match(/^([A-Z][A-Z0-9]{0,14})(?:\.US)?$/);
  if (usMatch) {
    const code = usMatch[1];
    if (!code) return invalidSymbol(input);
    return {
      canonical: `${code}.US`,
      market: 'us',
      providerSymbol: code
    };
  }

  return invalidSymbol(input);
}
