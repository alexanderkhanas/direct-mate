import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LangProvider } from './i18n';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ConversationsPage from './pages/ConversationsPage';
import ConversationDetailPage from './pages/ConversationDetailPage';
import ConnectionsPage from './pages/ConnectionsPage';
import SettingsPage from './pages/SettingsPage';
import LogsPage from './pages/LogsPage';
import CatalogPage from './pages/CatalogPage';
import TrainingPage from './pages/TrainingPage';
import TemplatesPage from './pages/TemplatesPage';
import TestingPage from './pages/TestingPage';
import SimulatorPage from './pages/SimulatorPage';
import OrdersPage from './pages/OrdersPage';
import ContentLinkingPage from './pages/ContentLinkingPage';
import TenantsPage from './pages/admin/TenantsPage';
import TenantDetailPage from './pages/admin/TenantDetailPage';
import StatsPage from './pages/admin/StatsPage';
import RegisterPage from './pages/RegisterPage';
import OnboardingPage from './pages/OnboardingPage';
import Layout from './components/Layout';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('accessToken');
  return token ? <>{children}</> : <Navigate to="/welcome" replace />;
}

export default function App() {
  return (
    <LangProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/welcome" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="conversations/:id" element={<ConversationDetailPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="connections" element={<ConnectionsPage />} />
          <Route path="training" element={<TrainingPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="testing" element={<TestingPage />} />
          <Route path="simulator" element={<SimulatorPage />} />
          <Route path="content-linking" element={<ContentLinkingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="admin/stores" element={<TenantsPage />} />
          <Route path="admin/stores/:id" element={<TenantDetailPage />} />
          <Route path="admin/analytics" element={<StatsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </LangProvider>
  );
}
