import { useMemo, useState } from "react";
import { PageContainer } from "../../components/layout/PageContainer";
import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";

const paymentMethods = ["DC", "Карта", "QR"] as const;

export const Checkout = () => {
  const items = useCartStore((state) => state.items);
  const total = useCartStore((state) => state.totalPrice());
  const [gameId, setGameId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const canConfirm = useMemo(() => {
    return Boolean(gameId && paymentMethod && proof);
  }, [gameId, paymentMethod, proof]);

  return (
    <PageContainer>
      <h2>Оформление заказа</h2>
      <div className="section">
        <h3>Ваш заказ</h3>
        <ul>
          {items.map((item) => (
            <li key={item.itemId}>
              {item.name} × {item.qty}
            </li>
          ))}
        </ul>
        <div className="total">{formatMoney(total)}</div>
      </div>
      <div className="section">
        <label>Игровой ID</label>
        <input value={gameId} onChange={(event) => setGameId(event.target.value)} />
      </div>
      <div className="section">
        <label>Метод оплаты</label>
        <div className="payment-grid">
          {paymentMethods.map((method) => (
            <button
              key={method}
              className={`payment-tile ${paymentMethod === method ? "active" : ""}`}
              onClick={() => setPaymentMethod(method)}
            >
              {method}
            </button>
          ))}
        </div>
      </div>
      <div className="section">
        <label>Чек (обязательно)</label>
        <input type="file" onChange={(event) => setProof(event.target.files?.[0] ?? null)} />
      </div>
      <button className="button primary" disabled={!canConfirm}>
        Я оплатил(а)
      </button>
      {!canConfirm && (
        <p className="hint">
          Прикрепите чек и выберите метод оплаты, чтобы подтвердить заказ.
        </p>
      )}
    </PageContainer>
  );
};
