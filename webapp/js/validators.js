export const sanitizeNumeric = (value) => value.replace(/\D/g, "");

export const validateAccountId = (value) => {
  if (!value) {
    return "Введите ID";
  }
  if (!/^\d+$/.test(value)) {
    return "ID должен содержать только цифры";
  }
  if (value.length < 5 || value.length > 16) {
    return "ID должен быть от 5 до 16 цифр";
  }
  return "";
};
