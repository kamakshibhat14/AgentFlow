import { useState } from "react";
import { nhost } from "./lib/nhost";
import Dashboard from "./Dashboard";
import "./App.css";

function App() {
  const [email, setEmail] = useState("viewer.b@agentflow.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      setMessage("Please enter email and password.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      console.log("Trying Nhost login...");
      console.log("Email:", email);

      const response = await nhost.auth.signInEmailPassword({
        email: email.trim(),
        password,
      });

      console.log("NHOST LOGIN RESPONSE:", response);

      if (response.body?.session) {
        const loggedUser = response.body.session.user;

        console.log("LOGIN SUCCESS");
        console.log("USER:", loggedUser);

        setCurrentUser(loggedUser);
        setLoggedIn(true);
        setMessage("");
      } else if (response.error) {
        console.error("NHOST AUTH ERROR:", response.error);

        setMessage(
          response.error.message || "Invalid email or password."
        );
      } else {
        setMessage("Login failed. Please try again.");
      }
    } catch (error) {
      console.error("LOGIN ERROR:", error);

      setMessage(
        error?.message || "Failed to connect to Nhost."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await nhost.auth.signOut();

      setLoggedIn(false);
      setCurrentUser(null);
      setPassword("");
      setMessage("");
    } catch (error) {
      console.error("LOGOUT ERROR:", error);
    }
  };

  /*
   * After successful login, show Dashboard
   */
  if (loggedIn) {
    return (
      <Dashboard
        user={currentUser}
        onLogout={handleLogout}
      />
    );
  }

  /*
   * Login screen
   */
  return (
    <div className="app-container">
      <div className="login-card">

        <div className="logo-section">
          <h1>AgentFlow</h1>
          <p>AI Agent Workflow Builder</p>
        </div>

        <form onSubmit={handleLogin}>

          <div className="form-group">
            <label htmlFor="email">
              Email
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">
              Password
            </label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading ? "Signing In..." : "Sign In"}
          </button>

        </form>

        {message && (
          <div className="login-message">
            {message}
          </div>
        )}

      </div>
    </div>
  );
}

export default App;