import { useMemo, useState } from "react";
import { PageContainer } from "../../components/layout/PageContainer";
import { useCartStore } from "../../store/cart.store";
import { formatMoney } from "../../utils/formatMoney";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { fetchPaymentQr, fetchPayments } from "../../api/payments.api";
import { createOrder, markPaid, uploadProof } from "../../api/orders.api";

const paymentMethods = ["DC", "Карта", "QR"] as const;

export const Checkout = () => {
  const items = useCartStore((state) => state.items);
  const total = useCartStore((state) => state.totalPrice());
  const clear = useCartStore((state) => state.clear);
  const [gameId, setGameId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: payments } = useQuery({ queryKey: ["payments"], queryFn: fetchPayments });
  const { data: qrData } = useQuery({
    queryKey: ["payments", "qr"],
    queryFn: fetchPaymentQr,
    enabled: Boolean(payments?.qr),
  });
  const canConfirm = useMemo(() => {
    return Boolean(gameId && paymentMethod && proof);
  }, [gameId, paymentMethod, proof]);

  const handleConfirm = async () => {
    if (!canConfirm) {
      setAttempted(true);
      return;
    }
    if (!proof) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const order = await createOrder({
        gameId,
        paymentMethod,
        items: items.map((item) => ({ itemId: item.itemId, qty: item.qty })),
      });
      await uploadProof(order.orderId, proof);
      const paid = await markPaid(order.orderId);
      setOrderId(order.orderId);
      setOrderStatus(paid.status);
      clear();
    } catch {
      setError("Что-то пошло не так. Попробуйте ещё раз через пару секунд.");
    } finally {
      setLoading(false);
    }
  };

  if (orderId) {
    return (
      <PageContainer>
        <h2>Заказ оформлен</h2>
        <div className="empty-state">
          <p>Номер заказа: #{orderId}</p>
          <p>Статус: {orderStatus}</p>
          <p>Мы проверим оплату и пришлём уведомление.</p>
        </div>
      </PageContainer>
    );
  }

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
          {paymentMethods
            .filter((method) => {
              if (method === "QR") {
                return Boolean(payments?.qr);
              }
              return true;
            })
            .map((method) => (
              <button
                key={method}
                className={`payment-tile ${paymentMethod === method ? "active" : ""}`}
                onClick={() => setPaymentMethod(method)}
              >
                {method}
              </button>
            ))}
        </div>
        {paymentMethod === "DC" && payments?.dc && (
          <div className="requisites">
            <div className="requisites-title">DC реквизиты</div>
            <div className="requisites-body">{payments.dc}</div>
          </div>
        )}
        {paymentMethod === "Карта" && payments?.card && (
          <div className="requisites">
            <div className="requisites-title">Реквизиты карты</div>
            <div className="requisites-body">{payments.card}</div>
          </div>
        )}
        {paymentMethod === "QR" && qrData?.url && (
          <div className="requisites">
            <div className="requisites-title">QR для оплаты</div>
            <img className="qr-image" src={qrData.url} alt="QR" />
          </div>
        )}
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
      <button className="button primary" disabled={!canConfirm || loading} onClick={handleConfirm}>
        {loading ? "Отправляем..." : "Я оплатил(а)"}
      </button>
      <div className="trust-note">
        <span>🔒</span>
        <span>Оплата проверяется вручную администратором</span>
      </div>
      {error && <p className="hint">{error}</p>}
      {!canConfirm && attempted && (
        <motion.p className="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          Прикрепите чек и выберите метод оплаты, чтобы подтвердить заказ.
        </motion.p>
      )}
    </PageContainer>
  );
};
