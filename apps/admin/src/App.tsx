import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
import Layout from './components/Layout';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('accessToken');
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="conversations/:id" element={<ConversationDetailPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="connections" element={<ConnectionsPage />} />
          <Route path="training" element={<TrainingPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="testing" element={<TestingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="logs" element={<LogsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
