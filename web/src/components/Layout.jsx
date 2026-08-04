import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Users, Upload, Settings, LogOut, Send } from 'lucide-react';

const Layout = ({ onLogout }) => {
  const location = useLocation();

  const handleLogout = () => {
    localStorage.removeItem('token');
    onLogout();
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <Users className="w-5 h-5 mr-3" /> },
    { path: '/import', label: 'Import Contacts', icon: <Upload className="w-5 h-5 mr-3" /> },
    { path: '/settings', label: 'Settings', icon: <Settings className="w-5 h-5 mr-3" /> },
  ];

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-6 flex items-center font-bold text-xl tracking-tight">
          <Send className="w-6 h-6 mr-3 text-blue-400" />
          ColdMail Pilot
        </div>
        <nav className="flex-1 px-4 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center px-4 py-3 rounded-lg transition-colors ${
                location.pathname === item.path ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4">
          <button 
            onClick={handleLogout}
            className="flex items-center w-full px-4 py-3 text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-50">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
