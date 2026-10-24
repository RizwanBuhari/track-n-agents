import { Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import ApprovalsPage from './pages/ApprovalsPage'
import CaseDetailPage from './pages/CaseDetailPage'
import CasesPage from './pages/CasesPage'
import OverviewPage from './pages/OverviewPage'
import ShipmentDetailPage from './pages/ShipmentDetailPage'
import ShipmentsPage from './pages/ShipmentsPage'
import SimulatorPage from './pages/SimulatorPage'
import SystemPage from './pages/SystemPage'
import UploadPage from './pages/UploadPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/shipments" element={<ShipmentsPage />} />
        <Route path="/shipments/:awb" element={<ShipmentDetailPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/:id" element={<CaseDetailPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/simulator" element={<SimulatorPage />} />
        <Route path="/system" element={<SystemPage />} />
      </Route>
    </Routes>
  )
}
