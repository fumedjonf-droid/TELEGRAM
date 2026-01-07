import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCategories, fetchItems } from "../../api/items.api";
import { AppHeader } from "../../components/layout/AppHeader";
import { BottomCartBar } from "../../components/layout/BottomCartBar";
import { PageContainer } from "../../components/layout/PageContainer";
import { CategoryBar } from "../../components/shop/CategoryBar";
import { ProductGrid } from "../../components/shop/ProductGrid";
import { SearchInput } from "../../components/shop/SearchInput";

export const ShopHome = () => {
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

  return (
    <PageContainer>
      <AppHeader />
      <SearchInput value={search} onChange={setSearch} />
      <CategoryBar categories={categories} activeId={activeCategory} onChange={setActiveCategory} />
      {isLoading ? <div className="skeleton">Загрузка...</div> : <ProductGrid items={filteredItems} />}
      <BottomCartBar />
    </PageContainer>
  );
};
