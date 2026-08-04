import React from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, Settings, LogOut, Send } from 'lucide-react';

const Layout = ({ onLogout }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    if (onLogout) onLogout();
    navigate('/login');
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/import', label: 'Import Contacts', icon: Users },
    { path: '/logs', label: 'Queue & Logs', icon: Send },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-zinc-950 font-sans text-zinc-300">
      {/* Sidebar */}
      <div className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-6 border-b border-zinc-800 flex items-center">
          <div className="w-8 h-8 rounded-lg bg-yellow-500 flex items-center justify-center mr-3 shadow-lg shadow-yellow-500/20">
            <Send className="w-4 h-4 text-zinc-950" />
          </div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">ColdMail</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link 
                key={item.path} 
                to={item.path}
                className={`flex items-center px-4 py-3 rounded-lg transition-all duration-200 ${
                  isActive 
                    ? 'bg-zinc-800 text-yellow-400 font-medium' 
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                }`}
              >
                <Icon className={`w-5 h-5 mr-3 ${isActive ? 'text-yellow-400' : 'text-zinc-500'}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <button 
            onClick={handleLogout}
            className="flex items-center w-full px-4 py-3 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-all duration-200"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-zinc-950">
        <Outlet />
      </div>
    </div>
  );
};

export default Layout;
