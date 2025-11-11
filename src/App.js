import React, { useState, useEffect } from "react";
import { Amplify } from "aws-amplify";
import { fetchAuthSession } from 'aws-amplify/auth';
import { uploadData, getUrl, list } from "@aws-amplify/storage";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import awsconfig from "./aws-exports";
import { LexRuntimeV2Client, RecognizeTextCommand } from "@aws-sdk/client-lex-runtime-v2";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import "./App.css";


// ======= YOUR AWS VALUES =======
const REGION = 'us-east-1';
const IDENTITY_POOL_ID = 'us-east-1:f0de591f-af21-493d-b00b-c1303b1b8a35';
const BOT_ID = '57DFNYXLFJ';
const BOT_ALIAS_ID = 'TSTALIASID';
const LOCALE_ID = 'en_US';
// ===============================

Amplify.configure(awsconfig);

// Custom Amplify theme
const theme = {
  name: 'custom-theme',
  tokens: {
    colors: {
      brand: {
        primary: {
          10: '#f0f7ff',
          20: '#e0f2ff',
          60: '#0a4a8a',
          80: '#0a4a8a',
          90: '#061e3e',
          100: '#000000',
        },
        secondary: {
          10: '#f5f5f5',
          20: '#efefef',
          60: '#666666',
          80: '#333333',
          90: '#1a1a1a',
          100: '#000000',
        },
      },
    },
  },
};



function LexChatbot({ user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [lexClient, setLexClient] = useState(null);
  const [loading, setLoading] = useState(false);
  const [initError, setInitError] = useState("");

  useEffect(() => {
    // Setup Lex client with authenticated Cognito credentials (Amplify v6+)
    const setupClient = async () => {
      try {
        const session = await fetchAuthSession();
        
        // ✅ FIX: Convert idToken to string
        const idTokenString = session.tokens?.idToken?.toString();
        
        if (!idTokenString) {
          throw new Error("No Cognito ID token found.");
        }
        
        console.log('Setting up Lex client with credentials...'); // Debug log
        
        const credentialProvider = fromCognitoIdentityPool({
          clientConfig: { region: REGION },
          identityPoolId: IDENTITY_POOL_ID,
          logins: {
            [`cognito-idp.${REGION}.amazonaws.com/${awsconfig.aws_user_pools_id}`]: idTokenString
          }
        });
        
        const client = new LexRuntimeV2Client({
          region: REGION,
          credentials: credentialProvider
        });
        
        setLexClient(client);
        setInitError("");
        console.log('Lex client initialized successfully!'); // Debug log
      } catch (e) {
        console.error('Failed to initialize Lex client:', e); // Debug log
        setInitError("Failed to initialize Lex client: " + e.message);
      }
    };
    
    setupClient();
  }, []);

  async function sendLexMessage() {
    if (!input || !lexClient) return;
    
    setMessages(prev => [...prev, { from: "user", text: input }]);
    setLoading(true);
    
    try {
      const cmd = new RecognizeTextCommand({
        botId: BOT_ID,
        botAliasId: BOT_ALIAS_ID,
        localeId: LOCALE_ID,
        sessionId: user?.username || "demo-session",
        text: input
      });
      
      const res = await lexClient.send(cmd);
      const botReply = res.messages?.[0]?.content || "(No response)";
      setMessages(prev => [...prev, { from: "bot", text: botReply }]);
    } catch (err) {
      console.error('Lex send error:', err); // Debug log
      setMessages(prev => [...prev, { from: "bot", text: "Error: " + err.message }]);
    }
    
    setInput("");
    setLoading(false);
  }

  return (
    <div className="component-card">
      <div className="card-title">💬 Lex Chatbot</div>
      <div className="chatbot-container">
        <div className="messages-area">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.from}`}>
              {msg.text}
            </div>
          ))}
        </div>
        <div className="input-area">
          <input
            type="text"
            className="message-input"
            value={input}
            disabled={loading}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => (e.key === "Enter" ? sendLexMessage() : null)}
            placeholder="Type your message..."
          />
          <button 
            className="send-btn"
            onClick={sendLexMessage} 
            disabled={loading || !input || !lexClient}
          >
            {loading ? '⏳' : '📤'}
          </button>
        </div>
        {!lexClient && !initError && (
          <div className="status-indicator connecting">🔄 Connecting to Lex bot...</div>
        )}
        {initError && (
          <div className="status-indicator error">❌ Error: {initError}</div>
        )}
        {lexClient && !initError && (
          <div className="status-indicator connected">✅ Connected to Lex bot</div>
        )}
      </div>
    </div>
  );
}


function S3Upload() {
  const [file, setFile] = useState(null);
  const [s3url, setS3url] = useState("");
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  // ✅ NEW: Load uploaded files on component mount
  useEffect(() => {
    loadFiles();
  }, []);

  // ✅ NEW: List all files from S3
  async function loadFiles() {
    setLoadingFiles(true);
    try {
      const result = await list();
      console.log('Files in S3:', result);
      setUploadedFiles(result.items || []);
    } catch (err) {
      console.error('Error loading files:', err);
      setUploadedFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }

  // ✅ NEW: Get presigned URL for a file
  async function getPresignedUrl(fileKey) {
    try {
      const { url } = await getUrl({ 
        key: fileKey,
        options: {
          expiresIn: 900, // 15 minutes
          accessLevel: 'guest'
        }
      });
      return url.toString();
    } catch (err) {
      console.error('Error getting presigned URL:', err);
      return null;
    }
  }

  async function uploadFile() {
    if (!file) return;
    
    setMsg("Uploading...");
    setUploading(true);
    
    try {
      // Generate unique filename to avoid overwrites
      const timestamp = new Date().getTime();
      const uniqueKey = `${timestamp}-${file.name}`;
      
      await uploadData({ 
        key: uniqueKey, 
        data: file, 
        options: { contentType: file.type } 
      });
      
      // Get presigned URL
      const presignedUrl = await getPresignedUrl(uniqueKey);
      
      if (presignedUrl) {
        setS3url(presignedUrl);
      } else {
        setS3url(`S3 file uploaded: ${uniqueKey}`);
      }
      
      setMsg("Upload successful! 🎉");
      setFile(null);
      
      // Reload file list
      await loadFiles();
    } catch (err) {
      console.error('Upload error:', err);
      setMsg("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="component-card">
      <div className="card-title">📁 S3 File Upload</div>
      
      <div className="file-upload-section">
        {/* File Input */}
        <div className="file-input-group">
          <input 
            type="file" 
            className="file-input"
            onChange={e => setFile(e.target.files[0])}
            disabled={uploading}
          />
          <button 
            className="upload-btn"
            onClick={uploadFile} 
            disabled={!file || uploading}
          >
            {uploading ? '⏳ Uploading...' : '📤 Upload'}
          </button>
        </div>

        {/* Upload Message */}
        {msg && (
          <div className={`upload-message ${msg.includes('failed') ? 'error' : 'success'}`}>
            {msg}
          </div>
        )}
        
        {/* Presigned URL Link */}
        {s3url && (
          <div style={{ marginTop: 12 }}>
            <a 
              href={s3url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="file-link"
            >
              � View Uploaded File (Valid for 15 min)
            </a>
          </div>
        )}
      </div>

      {/* List of All Uploaded Files */}
      <div className="files-section">
        <div className="files-section-title">📂 Uploaded Files</div>
        {loadingFiles ? (
          <p className="loading">Loading files...</p>
        ) : uploadedFiles.length > 0 ? (
          <>
            <ul className="files-list">
              {uploadedFiles.map((file, idx) => (
                <li key={idx} className="file-item">
                  <div className="file-name">📄 {file.name}</div>
                  <div className="file-info">
                    Size: {(file.size / 1024).toFixed(2)} KB | Modified: {new Date(file.lastModified).toLocaleDateString()}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="empty-files">
            No files uploaded yet
          </div>
        )}
        <button 
          className="refresh-btn"
          onClick={loadFiles}
          disabled={loadingFiles}
        >
          🔄 Refresh Files
        </button>
      </div>
    </div>
  );
}


function App({ signOut, user }) {
  return (
    <>
      {/* Floating Gel Background */}
      <div className="gel-background">
        <div className="gel-blob"></div>
        <div className="gel-blob"></div>
        <div className="gel-blob"></div>
      </div>

      {/* Navigation Bar */}
      <nav className="navbar">
        <div className="navbar-content">
          <div className="navbar-brand">MyApp</div>
          <div className="navbar-actions">
            <div className="user-info">👤 {user.username || user.attributes?.email}</div>
            <button 
              className="signout-btn"
              onClick={signOut}
            >
              🚪 Sign out
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="app-container">
        {/* Welcome Section */}
        <div className="welcome-section">
          <h1 className="welcome-title">Welcome Back! 🎉</h1>
          <p className="welcome-subtitle">
            {user.username || user.attributes?.email}
          </p>
        </div>

        {/* Lex Chatbot */}
        <LexChatbot user={user} />

        {/* S3 Upload */}
        <S3Upload />

        {/* Footer */}
        <div className="footer">
          <div>
            <span className="status-badge">✅ Cognito Auth</span>
            <span className="status-badge">✅ Lex Chatbot</span>
            <span className="status-badge">✅ S3 File Upload</span>
          </div>
          <p style={{ marginTop: 16 }}>
            🌊 Powered by AWS Amplify | Built with React | Secured by Cognito
          </p>
        </div>
      </div>
    </>
  );
}

// Wrap with Authenticator and custom theme
function AppWithAuth() {
  return (
    <Authenticator theme={theme}>
      {({ signOut, user }) => <App signOut={signOut} user={user} />}
    </Authenticator>
  );
}

export default AppWithAuth;
