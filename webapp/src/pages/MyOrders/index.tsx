import { PageContainer } from "../../components/layout/PageContainer";

export const MyOrders = () => (
  <PageContainer>
    <h2>Мои заказы</h2>
    <div className="empty-state">
      <p>У вас пока нет заказов. Давайте начнём 👇</p>
    </div>
  </PageContainer>
);
