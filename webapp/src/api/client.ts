export const apiClient = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const initData = window.Telegram?.WebApp?.initData;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(initData ? { "X-TG-INIT-DATA": initData } : {}),
      ...(options?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};
