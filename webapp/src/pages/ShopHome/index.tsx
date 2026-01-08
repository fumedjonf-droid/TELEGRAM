import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchItems } from "../../api/items.api";
import { AppHeader } from "../../components/layout/AppHeader";
import { BottomCartBar } from "../../components/layout/BottomCartBar";
import { PageContainer } from "../../components/layout/PageContainer";
import { CategoryBar } from "../../components/shop/CategoryBar";
import { ProductGrid } from "../../components/shop/ProductGrid";
import { SearchInput } from "../../components/shop/SearchInput";
import { useNavigate } from "react-router-dom";

export const ShopHome = () => {
  const navigate = useNavigate();
  const { data: items = [], isLoading } = useQuery({ queryKey: ["items"], queryFn: fetchItems });
  const [activeGameKey, setActiveGameKey] = useState<string | null>(
    () => localStorage.getItem("shop_game_key")
  );
  const categories = [
    { id: 1, name: "Все игры" },
    { id: 2, name: "FreeFire" },
    { id: 3, name: "Steam" },
    { id: 4, name: "PUBG Mobile" },
    { id: 5, name: "TG Stars" },
    { id: 6, name: "Mobile Legends" },
    { id: 7, name: "Genshin" }
  ];
  const [activeCategory, setActiveCategory] = useState<number | undefined>(1);
  const [search, setSearch] = useState("");
  const gameKeys = useMemo(() => {
    const keys = new Set(items.map((item) => item.gameKey).filter(Boolean));
    return Array.from(keys);
  }, [items]);

  const selectGame = (key: string) => {
    localStorage.setItem("shop_game_key", key);
    setActiveGameKey(key);
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeGameKey && item.gameKey !== activeGameKey) {
        return false;
      }
      const selected = categories.find((category) => category.id === activeCategory);
      const matchesCategory =
        !selected || selected.name === "Все игры" ? true : item.categoryName === selected.name;
      const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [items, activeCategory, search, categories, activeGameKey]);

  useEffect(() => {
    if (!localStorage.getItem("shop_welcome_seen")) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  return (
    <PageContainer>
      <AppHeader />
      {!activeGameKey ? (
        <div className="empty-state">
          <h3>Выберите игру</h3>
          <div className="category-bar">
            {gameKeys.map((key) => (
              <button key={key} className="category-pill" onClick={() => selectGame(key)}>
                {key}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <SearchInput value={search} onChange={setSearch} />
          <CategoryBar categories={categories} activeId={activeCategory} onChange={setActiveCategory} />
          {isLoading ? (
            <div className="grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton shimmer" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state">
              <p>Товары скоро появятся. Загляните чуть позже ✨</p>
            </div>
          ) : (
            <ProductGrid items={filteredItems} />
          )}
        </>
      )}
      <BottomCartBar />
    </PageContainer>
  );
};
