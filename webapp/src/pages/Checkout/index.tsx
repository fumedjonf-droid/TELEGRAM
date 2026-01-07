import { useMemo, useState } from "react";
import { PageContainer } from "../../components/layout/PageContainer";
import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";
import { motion } from "framer-motion";

const paymentMethods = ["DC", "Карта", "QR"] as const;

export const Checkout = () => {
  const items = useCartStore((state) => state.items);
  const total = useCartStore((state) => state.totalPrice());
  const [gameId, setGameId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [attempted, setAttempted] = useState(false);
  const canConfirm = useMemo(() => {
    return Boolean(gameId && paymentMethod && proof);
  }, [gameId, paymentMethod, proof]);

  const handleConfirm = () => {
    if (!canConfirm) {
      setAttempted(true);
    }
  };

  return (
    <PageContainer>
      <h2>Оформление заказа</h2>
      <div className="step-progress">
        {["Товары", "ID", "Оплата", "Подтверждение"].map((step, index) => (
          <div key={step} className={`step ${index <= 2 ? "active" : ""}`}>
            <span>{step}</span>
          </div>
        ))}
      </div>
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
        <div className={`proof-box ${attempted && !proof ? "highlight" : ""}`}>
          <div className="proof-icon">{proof ? "✅" : "📎"}</div>
          <div>
            <div className="proof-title">
              {proof ? "Чек получен" : "Прикрепите чек, чтобы мы начали проверку"}
            </div>
            <div className="proof-subtitle">Фото или файл оплаты</div>
          </div>
          <input type="file" onChange={(event) => setProof(event.target.files?.[0] ?? null)} />
        </div>
      </div>
      <button className="button primary" disabled={!canConfirm} onClick={handleConfirm}>
        Я оплатил(а)
      </button>
      <div className="trust-note">
        <span>🔒</span>
        <span>Оплата проверяется вручную администратором</span>
      </div>
      {!canConfirm && attempted && (
        <motion.p className="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          Прикрепите чек и выберите метод оплаты, чтобы подтвердить заказ.
        </motion.p>
      )}
    </PageContainer>
  );
};
