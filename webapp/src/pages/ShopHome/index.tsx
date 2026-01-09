import { useEffect, useMemo, useState } from "react";
import { PageContainer } from "../../components/layout/PageContainer";
import { motion } from "framer-motion";
import freeFireHero from "../../assets/free-fire.svg";
import steamHero from "../../assets/steam.svg";
import pubgHero from "../../assets/pubg.svg";
import um4dHero from "../../assets/um4d-hero.svg";

export const ShopHome = () => {
  const categories = useMemo(
    () => [
      { id: 1, name: "FREE FIRE", image: freeFireHero },
      { id: 2, name: "STEAM", image: steamHero },
      { id: 3, name: "PUBG MOBILE", image: pubgHero }
    ],
    []
  );
  const [isReady, setIsReady] = useState(false);
  const revealDelay = 0;
  const cardVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.97 },
    show: (index: number) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.46,
        ease: [0.2, 0.8, 0.2, 1],
        delay: revealDelay + index * 0.12
      }
    })
  };
  const logoDelay = revealDelay + categories.length * 0.12 + 0.1;

  useEffect(() => {
    const timer = window.setTimeout(() => setIsReady(true), 650);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <PageContainer>
      <div className="cinematic-shell">
        <motion.header
          className="hero-banner"
          initial={{ opacity: 0 }}
          animate={{ opacity: isReady ? 1 : 0 }}
          transition={{ duration: 0.45, delay: revealDelay }}
          style={{ backgroundImage: `url(${um4dHero})` }}
        >
          <motion.div
            className="hero-logo"
            initial={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }}
            animate={{ opacity: isReady ? 1 : 0, scale: isReady ? 1 : 0.9, filter: "blur(0px)" }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1], delay: logoDelay }}
          >
            UM4D
          </motion.div>
        </motion.header>
        <section className="category-stack">
          {categories.map((category, index) => (
            <motion.div
              key={category.id}
              className="category-card"
              custom={index}
              initial="hidden"
              animate={isReady ? "show" : "hidden"}
              variants={cardVariants}
              style={{ backgroundImage: `url(${category.image})` }}
            >
              <span className="category-title">{category.name}</span>
            </motion.div>
          ))}
        </section>
      </div>
    </PageContainer>
  );
};
