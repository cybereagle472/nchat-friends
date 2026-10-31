/**
 * End-to-End Encryption Service
 * Uses Web Crypto API for encryption (built into browsers, FREE)
 * Implements Signal-like protocol with:
 * - ECDH for key exchange
 * - AES-GCM for message encryption
 * - Key derivation using HKDF
 */

import { supabase } from '../supabaseClient';

// Key storage in IndexedDB for persistence
const DB_NAME = 'nchat_encryption';
const KEY_STORE = 'keys';

interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

interface ExportedKeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

interface EncryptedMessage {
  ciphertext: string;
  iv: string;
  publicKey?: string; // Ephemeral public key for initial exchange
}

interface StoredKeys {
  identityKeyPair: ExportedKeyPair;
  preKeys: { [keyId: string]: ExportedKeyPair };
  sessionKeys: { [peerId: string]: string }; // Base64 encoded shared secret
}

class EncryptionService {
  private db: IDBDatabase | null = null;
  private identityKeyPair: KeyPair | null = null;
  private sessionKeys: Map<string, CryptoKey> = new Map();

  /**
   * Initialize encryption service
   */
  async initialize(userId: string): Promise<boolean> {
    try {
      // Open IndexedDB
      await this.openDatabase();

      // Load or generate identity key pair
      const storedKeys = await this.getStoredKeys(userId);

      if (storedKeys?.identityKeyPair) {
        this.identityKeyPair = await this.importKeyPair(storedKeys.identityKeyPair);

        // Load session keys
        if (storedKeys.sessionKeys) {
          for (const [peerId, secretBase64] of Object.entries(storedKeys.sessionKeys)) {
            const secret = this.base64ToArrayBuffer(secretBase64);
            const derivedKey = await this.deriveEncryptionKey(secret);
            this.sessionKeys.set(peerId, derivedKey);
          }
        }
      } else {
        // Generate new identity key pair
        this.identityKeyPair = await this.generateKeyPair();
        await this.storeKeys(userId, {
          identityKeyPair: await this.exportKeyPair(this.identityKeyPair),
          preKeys: {},
          sessionKeys: {}
        });

        // Upload public key to server
        await this.uploadPublicKey(userId);
      }

      return true;
    } catch (error) {
      console.error('Failed to initialize encryption:', error);
      return false;
    }
  }

  /**
   * Generate ECDH key pair for key exchange
   */
  private async generateKeyPair(): Promise<KeyPair> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true, // extractable
      ['deriveKey', 'deriveBits']
    );

    return keyPair as KeyPair;
  }

  /**
   * Export key pair for storage
   */
  private async exportKeyPair(keyPair: KeyPair): Promise<ExportedKeyPair> {
    const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    return { publicKey, privateKey };
  }

  /**
   * Import key pair from storage
   */
  private async importKeyPair(exported: ExportedKeyPair): Promise<KeyPair> {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      exported.publicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      exported.privateKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );

    return { publicKey, privateKey };
  }

  /**
   * Upload public key to Supabase for others to fetch
   */
  private async uploadPublicKey(userId: string): Promise<void> {
    if (!this.identityKeyPair) return;

    const publicKeyJwk = await crypto.subtle.exportKey('jwk', this.identityKeyPair.publicKey);
    const publicKeyBase64 = btoa(JSON.stringify(publicKeyJwk));

    await supabase
      .from('encryption_keys')
      .upsert({
        user_id: userId,
        public_key: publicKeyBase64,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });
  }

  /**
   * Get peer's public key from server
   */
  async getPeerPublicKey(peerId: string): Promise<CryptoKey | null> {
    try {
      const { data, error } = await supabase
        .from('encryption_keys')
        .select('public_key')
        .eq('user_id', peerId)
        .single();

      if (error || !data) return null;

      const publicKeyJwk = JSON.parse(atob(data.public_key));
      return await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
    } catch (error) {
      console.error('Failed to get peer public key:', error);
      return null;
    }
  }

  /**
   * Establish session with peer (key exchange)
   */
  async establishSession(userId: string, peerId: string): Promise<boolean> {
    try {
      if (this.sessionKeys.has(peerId)) {
        return true; // Session already established
      }

      if (!this.identityKeyPair) {
        await this.initialize(userId);
      }

      const peerPublicKey = await this.getPeerPublicKey(peerId);
      if (!peerPublicKey || !this.identityKeyPair) {
        return false;
      }

      // Derive shared secret using ECDH
      const sharedSecret = await crypto.subtle.deriveBits(
        {
          name: 'ECDH',
          public: peerPublicKey
        },
        this.identityKeyPair.privateKey,
        256
      );

      // Derive encryption key from shared secret
      const encryptionKey = await this.deriveEncryptionKey(sharedSecret);
      this.sessionKeys.set(peerId, encryptionKey);

      // Store session key
      const storedKeys = await this.getStoredKeys(userId);
      if (storedKeys) {
        storedKeys.sessionKeys[peerId] = this.arrayBufferToBase64(sharedSecret);
        await this.storeKeys(userId, storedKeys);
      }

      return true;
    } catch (error) {
      console.error('Failed to establish session:', error);
      return false;
    }
  }

  /**
   * Derive AES-GCM key from shared secret
   */
  private async deriveEncryptionKey(sharedSecret: ArrayBuffer): Promise<CryptoKey> {
    // Import shared secret as raw key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      'HKDF',
      false,
      ['deriveKey']
    );

    // Derive AES-GCM key using HKDF
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('nchat-e2ee-salt'),
        info: new TextEncoder().encode('nchat-e2ee-key')
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt a message
   */
  async encryptMessage(peerId: string, plaintext: string): Promise<EncryptedMessage | null> {
    try {
      const sessionKey = this.sessionKeys.get(peerId);
      if (!sessionKey) {
        console.error('No session key for peer:', peerId);
        return null;
      }

      // Generate random IV
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // Encrypt message
      const encodedMessage = new TextEncoder().encode(plaintext);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        sessionKey,
        encodedMessage
      );

      return {
        ciphertext: this.arrayBufferToBase64(ciphertext),
        iv: this.arrayBufferToBase64(iv)
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      return null;
    }
  }

  /**
   * Decrypt a message
   */
  async decryptMessage(peerId: string, encrypted: EncryptedMessage): Promise<string | null> {
    try {
      const sessionKey = this.sessionKeys.get(peerId);
      if (!sessionKey) {
        console.error('No session key for peer:', peerId);
        return null;
      }

      const ciphertext = this.base64ToArrayBuffer(encrypted.ciphertext);
      const iv = this.base64ToArrayBuffer(encrypted.iv);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        sessionKey,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      return null;
    }
  }

  /**
   * Check if E2EE is available for a peer
   */
  async isE2EEAvailable(peerId: string): Promise<boolean> {
    if (this.sessionKeys.has(peerId)) return true;

    const peerPublicKey = await this.getPeerPublicKey(peerId);
    return peerPublicKey !== null;
  }

  /**
   * Get encryption status for UI
   */
  getEncryptionStatus(peerId: string): 'encrypted' | 'pending' | 'unavailable' {
    if (this.sessionKeys.has(peerId)) return 'encrypted';
    return 'pending';
  }

  // IndexedDB helpers
  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          db.createObjectStore(KEY_STORE, { keyPath: 'userId' });
        }
      };
    });
  }

  private getStoredKeys(userId: string): Promise<StoredKeys | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve(null);
        return;
      }

      const transaction = this.db.transaction(KEY_STORE, 'readonly');
      const store = transaction.objectStore(KEY_STORE);
      const request = store.get(userId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.keys || null);
    });
  }

  private storeKeys(userId: string, keys: StoredKeys): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      const transaction = this.db.transaction(KEY_STORE, 'readwrite');
      const store = transaction.objectStore(KEY_STORE);
      const request = store.put({ userId, keys });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Utility functions
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export const encryptionService = new EncryptionService();
export default encryptionService;
