import React, { useState, useEffect } from "react";
import { Amplify } from "aws-amplify";
import { fetchAuthSession } from 'aws-amplify/auth';
import { uploadData, getUrl, list } from "@aws-amplify/storage";
import { withAuthenticator } from "@aws-amplify/ui-react";
import awsconfig from "./aws-exports";
import { LexRuntimeV2Client, RecognizeTextCommand } from "@aws-sdk/client-lex-runtime-v2";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";


// ======= YOUR AWS VALUES =======
const REGION = 'us-east-1';
const IDENTITY_POOL_ID = 'us-east-1:f0de591f-af21-493d-b00b-c1303b1b8a35';
const BOT_ID = '57DFNYXLFJ';
const BOT_ALIAS_ID = 'TSTALIASID';
const LOCALE_ID = 'en_US';
// ===============================

Amplify.configure(awsconfig);



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
    <div style={{ border: "1px solid #aaa", borderRadius: 8, padding: 16, marginBottom: 32, maxWidth: 500 }}>
      <h3>Lex Chatbot</h3>
      <div style={{ minHeight: 100, marginBottom: 16, maxHeight: 300, overflowY: 'auto' }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{
            fontWeight: msg.from === "user" ? "bold" : "normal",
            marginBottom: 8,
            padding: 8,
            backgroundColor: msg.from === "user" ? "#e7f5ff" : "#f8f9fa",
            borderRadius: 4
          }}>
            {msg.from === "user" ? "You: " : "Bot: "}{msg.text}
          </div>
        ))}
      </div>
      <input
        value={input}
        disabled={loading}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => (e.key === "Enter" ? sendLexMessage() : null)}
        style={{ width: "70%", padding: 8 }}
        placeholder="Type your message..."
      />
      <button 
        onClick={sendLexMessage} 
        disabled={loading || !input || !lexClient} 
        style={{ 
          marginLeft: 8, 
          padding: 8,
          cursor: (loading || !input || !lexClient) ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Sending...' : 'Send'}
      </button>
      {!lexClient && !initError && (
        <div style={{color:'#228be6', marginTop:'8px'}}>🔄 Connecting to Lex bot...</div>
      )}
      {initError && (
        <div style={{color:'#e03131', marginTop:'8px'}}>❌ Lex Bot Error: {initError}</div>
      )}
      {lexClient && !initError && (
        <div style={{color:'#2b8a3e', marginTop:'8px'}}>✅ Connected to Lex bot</div>
      )}
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
    <div style={{ border: "1px solid #aaa", borderRadius: 8, padding: 16, marginBottom: 32, maxWidth: 600 }}>
      <h3>S3 File Upload</h3>
      
      {/* File Input */}
      <div style={{ marginBottom: 12 }}>
        <input 
          type="file" 
          onChange={e => setFile(e.target.files[0])}
          disabled={uploading}
        />
        <button 
          onClick={uploadFile} 
          disabled={!file || uploading} 
          style={{ 
            marginLeft: 8,
            padding: "8px 16px",
            backgroundColor: "#228be6",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: (!file || uploading) ? 'not-allowed' : 'pointer'
          }}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      {/* Upload Message */}
      <div style={{ marginTop: 12 }}>
        {msg && (
          <div style={{ 
            color: msg.includes('failed') ? '#e03131' : '#2b8a3e',
            padding: '8px',
            backgroundColor: msg.includes('failed') ? '#ffe3e3' : '#e7f5e9',
            borderRadius: '4px',
            marginBottom: '12px'
          }}>
            {msg}
          </div>
        )}
        
        {/* Presigned URL Link */}
        {s3url && (
          <div style={{ marginTop: 8 }}>
            <a 
              href={s3url} 
              target="_blank" 
              rel="noopener noreferrer" 
              style={{ 
                color: '#228be6', 
                textDecoration: 'none',
                fontWeight: 'bold'
              }}
            >
              📁 View Uploaded File (Valid for 15 min)
            </a>
          </div>
        )}
      </div>

      {/* List of All Uploaded Files */}
      <div style={{ marginTop: 20, borderTop: '1px solid #ddd', paddingTop: 16 }}>
        <h4>📂 Uploaded Files</h4>
        {loadingFiles ? (
          <p>Loading files...</p>
        ) : uploadedFiles.length > 0 ? (
          <ul style={{ marginTop: 8 }}>
            {uploadedFiles.map((file, idx) => (
              <li key={idx} style={{ 
                marginBottom: 8,
                padding: 8,
                backgroundColor: '#f8f9fa',
                borderRadius: 4
              }}>
                <strong>{file.name}</strong>
                <br />
                <small style={{ color: '#666' }}>
                  Size: {(file.size / 1024).toFixed(2)} KB | Modified: {new Date(file.lastModified).toLocaleDateString()}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#999' }}>No files uploaded yet</p>
        )}
        <button 
          onClick={loadFiles}
          disabled={loadingFiles}
          style={{
            marginTop: 8,
            padding: "6px 12px",
            backgroundColor: "#6c757d",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: loadingFiles ? 'not-allowed' : 'pointer'
          }}
        >
          Refresh Files
        </button>
      </div>
    </div>
  );
}


function App({ signOut, user }) {
  return (
    <div style={{ margin: "2rem", fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ color: "#228be6" }}>
        Welcome, {user.username || user.attributes?.email}!
      </h1>
      <button 
        onClick={signOut} 
        style={{ 
          padding: "0.5rem 1.5rem", 
          background: "#228be6", 
          color: "#fff", 
          border: "none", 
          borderRadius: "6px",
          cursor: 'pointer',
          fontSize: '14px'
        }}
      >
        Sign out
      </button>
      <hr style={{ margin: '24px 0' }} />
      
      <LexChatbot user={user} />
      <S3Upload />
      
      <hr style={{ margin: '24px 0' }} />
      <p style={{ color: '#666', fontSize: '14px' }}>
        ✅ Cognito Auth | ✅ Lex Chatbot | ✅ S3 File Upload
      </p>
    </div>
  );
}

export default withAuthenticator(App);
