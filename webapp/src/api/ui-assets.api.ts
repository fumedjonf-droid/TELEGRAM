export type UiAssets = {
  headerSrc: string;
  logoSrc: string;
};

export const fetchUiAssets = async (): Promise<UiAssets> => {
  const response = await fetch("/assets/ui.json");
  if (!response.ok) {
    throw new Error("Failed to load UI assets");
  }
  return response.json();
};
