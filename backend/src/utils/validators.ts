export const isValidGameId = (value: string, min = 5, max = 16): boolean => {
  if (!/^[0-9]+$/.test(value)) {
    return false;
  }
  return value.length >= min && value.length <= max;
};

export const isValidQuantity = (value: number): boolean => Number.isInteger(value) && value > 0;
