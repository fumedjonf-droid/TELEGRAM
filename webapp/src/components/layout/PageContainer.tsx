import { PropsWithChildren } from "react";
import { motion } from "framer-motion";

const pageVariants = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -24 }
};

export const PageContainer = ({ children }: PropsWithChildren) => (
  <motion.main
    className="page"
    variants={pageVariants}
    initial="initial"
    animate="animate"
    exit="exit"
    transition={{ duration: 0.2 }}
  >
    {children}
  </motion.main>
);
