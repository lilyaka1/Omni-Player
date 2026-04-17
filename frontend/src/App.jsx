import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { initGlobalGlass } from './legacy/utils/glass';
import { initGlobalTheme } from './legacy/utils/theme';
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import LivePage from './pages/LivePage';
import ProfilePage from './pages/ProfilePage';
import RoomPage from './pages/RoomPage';
import LoginPage from './pages/LoginPage';

export default function App() {
  useEffect(() => {
    const cleanupTheme = initGlobalTheme();
    const cleanupGlass = initGlobalGlass();

    return () => {
      cleanupTheme?.();
      cleanupGlass?.();
    };
  }, []);

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login.html" element={<LoginPage />} />
      <Route path="/player" element={<LibraryPage />} />
      <Route path="/player.html" element={<LibraryPage />} />
      <Route path="/live" element={<LivePage />} />
      <Route path="/live.html" element={<LivePage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/user.html" element={<ProfilePage />} />
      <Route path="/user" element={<RoomPage />} />
      <Route path="/room" element={<RoomPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
