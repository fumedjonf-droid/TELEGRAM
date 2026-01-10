import { useEffect } from "react";
import { useTelegram } from "./useTelegram";

type Options = {
  text: string;
  onClick: () => void;
  visible?: boolean;
};

export const useMainButton = ({ text, onClick, visible = true }: Options) => {
  const { webApp } = useTelegram();

  useEffect(() => {
    if (!webApp) {
      return;
    }
    if (visible) {
      webApp.MainButton.setText(text);
      webApp.MainButton.show();
    } else {
      webApp.MainButton.hide();
    }
    webApp.MainButton.onClick(onClick);
    return () => {
      webApp.MainButton.offClick(onClick);
    };
  }, [onClick, text, visible, webApp]);
};
