export const SearchInput = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
  <input
    className="search"
    placeholder="Поиск товаров"
    value={value}
    onChange={(event) => onChange(event.target.value)}
  />
);
