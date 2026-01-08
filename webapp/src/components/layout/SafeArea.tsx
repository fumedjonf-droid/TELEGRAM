import { PropsWithChildren } from "react";

export const SafeArea = ({ children }: PropsWithChildren) => (
  <div className="safe-area">{children}</div>
);
