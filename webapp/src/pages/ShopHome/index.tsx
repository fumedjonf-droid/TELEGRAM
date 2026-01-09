import { useEffect, useMemo, useState } from "react";
import { PageContainer } from "../../components/layout/PageContainer";
import { motion } from "framer-motion";

export const ShopHome = () => {
  const categories = useMemo(
    () => [
      { id: 1, name: "FREE FIRE", style: "free-fire" },
      { id: 2, name: "STEAM", style: "steam" },
      { id: 3, name: "PUBG MOBILE", style: "pubg-mobile" }
    ],
    []
  );
  const [isReady, setIsReady] = useState(false);
  const revealDelay = 0;
  const cardVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.96 },
    show: (index: number) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.48,
        ease: [0.2, 0.8, 0.2, 1],
        delay: revealDelay + index * 0.14
      }
    })
  };
  const logoDelay = revealDelay + categories.length * 0.14 + 0.1;

  useEffect(() => {
    const timer = window.setTimeout(() => setIsReady(true), 650);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <PageContainer>
      <div className="cinematic-shell">
        <motion.header
          className="shop-header"
          initial={{ opacity: 0 }}
          animate={{ opacity: isReady ? 1 : 0 }}
          transition={{ duration: 0.3, delay: revealDelay }}
        >
          <div className="shop-header-left">
            <span className="icon-button">←</span>
            <span className="header-label">Назад</span>
          </div>
          <div className="shop-header-right">
            <span className="icon-button">⌄</span>
            <span className="icon-button">⋮</span>
          </div>
        </motion.header>
        <motion.section
          className="hero-banner"
          initial={{ opacity: 0 }}
          animate={{ opacity: isReady ? 1 : 0 }}
          transition={{ duration: 0.35, delay: revealDelay }}
        >
          <motion.div
            className="hero-logo"
            initial={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }}
            animate={{ opacity: isReady ? 1 : 0, scale: isReady ? 1 : 0.9, filter: "blur(0px)" }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1], delay: logoDelay }}
          >
            UM4D
          </motion.div>
        </motion.section>
        <section className="category-stack">
          {categories.map((category, index) => (
            <motion.div
              key={category.id}
              className={`category-card ${category.style}`}
              custom={index}
              initial="hidden"
              animate={isReady ? "show" : "hidden"}
              variants={cardVariants}
            >
              <span className="category-title">{category.name}</span>
            </motion.div>
          ))}
        </section>
      </div>
    </PageContainer>
  );
};
