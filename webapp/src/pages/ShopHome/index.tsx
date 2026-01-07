import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCategories, fetchItems } from "../../api/items.api";
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
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories
  });
  const [activeCategory, setActiveCategory] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory = activeCategory ? item.categoryId === activeCategory : true;
      const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [items, activeCategory, search]);

  useEffect(() => {
    if (!localStorage.getItem("shop_welcome_seen")) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  return (
    <PageContainer>
      <AppHeader />
      <SearchInput value={search} onChange={setSearch} />
      <CategoryBar categories={categories} activeId={activeCategory} onChange={setActiveCategory} />
      {isLoading ? (
        <div className="skeleton shimmer" />
      ) : filteredItems.length === 0 ? (
        <div className="empty-state">
          <p>Товары скоро появятся. Загляните чуть позже ✨</p>
        </div>
      ) : (
        <ProductGrid items={filteredItems} />
      )}
      <BottomCartBar />
    </PageContainer>
  );
};
