import { PageContainer } from "../../components/layout/PageContainer";
import { StatusTimeline } from "../../components/orders/StatusTimeline";

export const OrderDetails = () => (
  <PageContainer>
    <h2>Детали заказа</h2>
    <StatusTimeline status="paid_review" />
  </PageContainer>
);
