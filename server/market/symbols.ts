function invalidSymbol(input) {
  throw new Error(`Invalid market symbol: ${String(input)}`);
}

export function normalizeSymbol(input) {
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
    return {
      canonical: `${hkMatch[1]}.HK`,
      market: 'hk',
      providerSymbol: `${hkMatch[1]}.HK`
    };
  }

  const usMatch = symbol.match(/^([A-Z][A-Z0-9]{0,14})(?:\.US)?$/);
  if (usMatch) {
    return {
      canonical: `${usMatch[1]}.US`,
      market: 'us',
      providerSymbol: usMatch[1]
    };
  }

  return invalidSymbol(input);
}
