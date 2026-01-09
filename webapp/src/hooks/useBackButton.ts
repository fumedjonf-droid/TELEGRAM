import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTelegram } from "./useTelegram";

export const useBackButton = () => {
  const { webApp } = useTelegram();
  const navigate = useNavigate();

  useEffect(() => {
    if (!webApp) {
      return;
    }
    const handler = () => navigate(-1);
    webApp.BackButton.show();
    webApp.BackButton.onClick(handler);
    return () => {
      webApp.BackButton.offClick(handler);
      webApp.BackButton.hide();
    };
  }, [navigate, webApp]);
};
