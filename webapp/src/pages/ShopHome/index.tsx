import { useEffect, useMemo, useState } from "react";
import { PageContainer } from "../../components/layout/PageContainer";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchCategories } from "../../api/categories.api";
import { fetchUiAssets } from "../../api/ui-assets.api";
import { SkeletonCard } from "../../components/common/SkeletonCard";

export const ShopHome = () => {
  const { data: apiCategories = [], isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories
  });
  const { data: uiAssets } = useQuery({
    queryKey: ["ui-assets"],
    queryFn: fetchUiAssets
  });
  const headerSrc = uiAssets?.headerSrc ?? "/assets/header/header.svg";
  const logoSrc = uiAssets?.logoSrc ?? "/assets/logo/logo.svg";
  const fallbackCategories = useMemo(
    () => [
      { id: 1, name: "FREE FIRE", iconUrl: "/assets/categories/freefire.svg" },
      { id: 2, name: "PUBG MOBILE", iconUrl: "/assets/categories/pubg.svg" },
      { id: 3, name: "STEAM", iconUrl: "/assets/categories/steam.svg" }
    ],
    []
  );
  const categories = useMemo(() => {
    const allowed = ["FREE FIRE", "PUBG MOBILE", "STEAM"];
    const normalize = (value: string) => value.toUpperCase().replace(/\s+/g, " ").trim();
    const fallbackMap = new Map(fallbackCategories.map((category) => [category.name, category.iconUrl]));
    const mapped = apiCategories
      .filter((category) => allowed.includes(normalize(category.name)))
      .map((category) => ({
        id: category.id,
        name: normalize(category.name),
        iconUrl: category.iconUrl ?? fallbackMap.get(normalize(category.name)) ?? ""
      }))
      .sort((a, b) => allowed.indexOf(a.name) - allowed.indexOf(b.name));
    return mapped.length ? mapped : fallbackCategories;
  }, [apiCategories, fallbackCategories]);
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
          initial={{ opacity: 0, scale: 1.03 }}
          animate={{ opacity: isReady ? 1 : 0, scale: isReady ? 1 : 1.03 }}
          transition={{ duration: 0.45, delay: revealDelay }}
          style={{ backgroundImage: `url(${headerSrc})` }}
        >
          <motion.img
            className="hero-logo"
            src={logoSrc}
            alt="UM4D"
            initial={{ opacity: 0, scale: 0.9, filter: "blur(6px)" }}
            animate={{ opacity: isReady ? 1 : 0, scale: isReady ? 1 : 0.9, filter: "blur(0px)" }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1], delay: logoDelay }}
          />
        </motion.header>
        <section className="category-stack">
          {isLoading
            ? Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} />)
            : categories.map((category, index) => (
                <motion.div
                  key={category.id}
                  className="category-card"
                  custom={index}
                  initial="hidden"
                  animate={isReady ? "show" : "hidden"}
                  variants={cardVariants}
                  style={{ backgroundImage: `url(${category.iconUrl})` }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className="category-title">{category.name}</span>
                </motion.div>
              ))}
        </section>
      </div>
    </PageContainer>
  );
};
