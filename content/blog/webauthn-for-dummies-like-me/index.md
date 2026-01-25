---
title: "WebAuthn for Dummies Like Me"
date: 2026-01-25T00:00:00Z
lastmod: 2026-01-25T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "WebAuthn authentication is simpler than it seems, and understanding it yourself is worth the effort."
abstract: "What does implementing WebAuthn actually look like?"
tags: ["software engineering", "security", "authentication", "webauthn", "cryptography"]
keywords: ["WebAuthn", "passkeys", "authentication", "public-key cryptography", "FIDO2", "passwordless", "phishing-resistant", "Go", "implementation"]
toc: false
---

For a new project at work, we didn't want to do passwords. The two candidates were magic links and WebAuthn, and we ended up going with magic links—but I got curious about WebAuthn anyway, so I built a demo app to understand it. 

The protocol has a reputation for complexity (the spec is over 100 pages, the prose is dense with acronyms that I only have a passing familiarity with, and of course, there are libraries that abstract everything away), and I expected to find layers of subtle, easy-to-get-wrong machinery once I started digging. But it turned out to be a very simple protocol that makes it easy to build secure authentication.

Most of what makes WebAuthn seem complicated is the browser and authenticator's problem, not the developer's. If you're implementing a server—what the spec calls the "relying party"—the surface area is small. I wrote a complete working implementation in a few hundred lines of Go, and most of that is HTTP boilerplate. The actual WebAuthn logic is maybe 200 lines, and much of that is parsing binary formats.

The core idea is public-key cryptography applied to web authentication. During registration, the authenticator (Touch ID, Windows Hello, a YubiKey) generates a keypair and gives you the public key. During authentication, the authenticator proves it has the private key by signing a challenge. The server never sees the private key, and there's no shared secret that could be stolen from a database breach or phished from a user.

But what does that look like concretely?

## Registration

The server's job during registration is to generate a challenge, tell the browser what kind of credential it wants, and then parse and store what comes back.

The challenge is just 32 random bytes—its purpose is to prevent replay attacks. Without a fresh challenge each time, an attacker could capture a valid signature and reuse it. SSH does the same thing: when you connect, the server sends random session data for you to sign, and that signature is only valid for that session.

```go
challenge := make([]byte, 32)
rand.Read(challenge)
```

You send this to the browser along with some metadata about your site (the "relying party" ID—usually just your domain) and what algorithm you want (ES256 is the standard choice, which is ECDSA with the P-256 curve):

```go
options := map[string]interface{}{
    "challenge": base64.RawURLEncoding.EncodeToString(challenge),
    "rp": map[string]string{
        "id":   "localhost",
        "name": "WebAuthn Demo",
    },
    "user": map[string]interface{}{
        "id":          base64.RawURLEncoding.EncodeToString(userHandle),
        "name":        username,
        "displayName": username,
    },
    "pubKeyCredParams": []map[string]interface{}{
        {"type": "public-key", "alg": -7},
    },
    "attestation": "none",
}
```

The browser takes these options and calls into the platform authenticator:

```javascript
const credential = await navigator.credentials.create({
    publicKey: publicKeyOptions
});
```

This is where the user sees a prompt—Touch ID, a Bitwarden prompt, or whatever their preferred authenticator is. The authenticator generates the keypair, stores the private key internally, and returns an "attestation object" containing the public key.

The attestation object is CBOR-encoded[^cbor] (I used a library for unmarshalling this, since it's the one part of the flow that isn't in Go's standard library), and inside it is something called "authenticator data" which has a specific binary layout. The spec describes it in detail, but the gist is: the first 32 bytes are a hash of the relying party ID, then there's a flags byte, a 4-byte signature counter, and then (if the flags indicate it) the credential ID and public key.

Parsing this is straightforward once you know the offsets:

```go
// Decode the CBOR wrapper
var att attestationObject
cbor.Unmarshal(data, &att)

// The authenticator data is a binary blob inside
authData := att.AuthData

// Credential ID length is at bytes 53-54, big-endian
credIDLen := int(authData[53])<<8 | int(authData[54])
cred.CredentialID = authData[55 : 55+credIDLen]

// Everything after that is the COSE-encoded public key
coseKeyData := authData[55+credIDLen:]
```

The COSE key[^cose] is itself another CBOR structure—a map from integer keys to values. For an EC key, you're extracting the X and Y coordinates of the elliptic curve point:

```go
var coseKey map[int]interface{}
cbor.Unmarshal(coseKeyData, &coseKey)

xBytes := coseKey[-2].([]byte)
yBytes := coseKey[-3].([]byte)

pubKey := &ecdsa.PublicKey{
    Curve: elliptic.P256(),
    X:     new(big.Int).SetBytes(xBytes),
    Y:     new(big.Int).SetBytes(yBytes),
}
```

You store this public key associated with the user, and registration is done.

The database schema for this is minimal:

```sql
CREATE TABLE credentials (
    credential_id   TEXT PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    public_key      BLOB,
    sign_count      INTEGER DEFAULT 0
);
```

You could add a "name" column to store authenticator metadata, too, but these are the essentials.

## Authentication

Authentication follows the same pattern: generate a challenge, send it to the browser, get back a signature, verify it.

```javascript
const assertion = await navigator.credentials.get({
    publicKey: {
        challenge: base64urlToBuffer(options.challenge),
        rpId: options.rpId,
        userVerification: "preferred"
    }
});
```

The authenticator finds the matching credential, prompts the user, and signs the challenge with the stored private key. What comes back is the signature along with some metadata (the "authenticator data" again, this time without the credential since it's already registered).

The signature is computed over a specific message: the authenticator data concatenated with a SHA-256 hash of the "client data JSON" (which contains the challenge and the origin). On the server side, you reconstruct this message and verify:

```go
clientDataHash := sha256.Sum256(clientDataJSON)

signedData := make([]byte, len(authenticatorData)+32)
copy(signedData, authenticatorData)
copy(signedData[len(authenticatorData):], clientDataHash[:])

hash := sha256.Sum256(signedData)

r, s, err := parseASN1Signature(signature)
if err != nil {
    return fmt.Errorf("failed to parse signature: %w", err)
}
if !ecdsa.Verify(pubKey, hash[:], r, s) {
    return fmt.Errorf("signature verification failed")
}
```

The signature is ASN.1 DER-encoded[^asn1], so there's a bit of parsing to extract the r and s values, but it's mechanical.

You also need to verify that the challenge in the client data matches the one you sent—this is what actually prevents replay attacks:

```go
var cd clientData
json.Unmarshal(clientDataJSON, &cd)

// cd.Challenge is the base64url-encoded challenge from the authenticator
if cd.Challenge != base64.RawURLEncoding.EncodeToString(expectedChallenge) {
    return fmt.Errorf("challenge mismatch")
}
```

The sign count in the authenticator data is a clone detection mechanism: each time an authenticator signs, it increments a counter, and if the count ever goes backwards or doesn't increase, someone may have copied the private key. But synced passkeys (iCloud Keychain, Google Password Manager) make this unreliable—if the same credential exists on multiple devices, there's no way to keep the counter in sync without coordination, and you get race conditions. If your system only allows hardware authenticators, you can treat a failed sign count check as a hard failure. But most consumer webapps allow synced passkeys and don't seem to bother with it.

[^cbor]: CBOR (Concise Binary Object Representation) is a binary encoding for data structures, like JSON but more compact. It was designed for constrained environments (IoT, embedded systems) where parsing JSON is expensive. WebAuthn uses it because authenticators are often small hardware devices.

[^cose]: COSE (CBOR Object Signing and Encryption) is a standard for representing cryptographic keys and signatures using CBOR. It's the CBOR equivalent of JOSE (JSON Object Signing and Encryption, which gives us JWTs). The integer keys (-2 for x, -3 for y) are terse by design—again, constrained environments.

[^asn1]: ASN.1 is a schema language from the telecom and X.509 world, predating JSON and Protocol Buffers by decades. DER is one of its binary encodings. ECDSA signatures are just two big integers (r and s), and you could imagine encoding them by just concatenating two 32-byte values—but cryptographic standards inherit from older infrastructure, so we get ASN.1.

[^otp]: One-Time Passwords—the six-digit codes from an authenticator app or SMS. The classic phishing attack: someone calls pretending to be support, asks you to read out your code "to verify your identity," and uses it to log in as you. This doesn't work with WebAuthn—there's nothing to read out. They'd need your physical authenticator.

## Origin binding prevents phishing

The client data JSON that gets signed includes the origin:

```go
type clientData struct {
    Type      string `json:"type"`
    Challenge string `json:"challenge"`
    Origin    string `json:"origin"`
}
```

The server verifies this matches the expected origin:

```go
if cd.Origin != rpOrigin {
    return fmt.Errorf("origin mismatch: got %q, want %q", cd.Origin, rpOrigin)
}
```

This is what makes WebAuthn phishing-resistant, and it's worth pausing on because it's different from how every other authentication mechanism works.

If a user visits `evil-bank.com` thinking it's `bank.com`, any credential they have for `bank.com` won't work—the authenticator signs a message that includes `evil-bank.com` as the origin, and when the attacker tries to forward that to the real bank, the origin check fails. The signature is bound to the domain. There's no secret that can be captured and replayed. (WebAuthn also requires HTTPS—the browser won't expose the `navigator.credentials` API without a secure context, though localhost is exempted for development.)

With passwords, the user types their password into the fake site and the attacker has it. With magic links, a sophisticated attacker can proxy the flow. With OTPs[^otp], real-time phishing works. WebAuthn is the only widely-deployed auth mechanism where phishing doesn't work at the protocol level—not because we're trusting users to be careful, but because the cryptography prevents it.

## It's not quite there yet

The protocol is simple. The UX is fine too—if users expect it. The issue is that nobody big has committed to passkeys-only yet. There are still edge cases: account recovery when you lose all your devices, cross-ecosystem sync (iPhone user with a Windows laptop), explaining to users why they need to set up credentials on multiple devices. These aren't unsolvable problems, but solving them well takes effort, and no major player has fully figured it out in public yet.

For the webapp we're building, we didn't want to spend our innovation budget there. Magic links, on the other hand, are common enough these days that users understand them, so we went with that for now. Admittedly, magic links are more of an "ignorance is bliss" choice than a truly secure one, but it is what it is.

## On "don't roll your own auth"

There's a reflexive piece of advice in security circles: don't implement your own authentication. Use a library. Use a service. Don't touch it.

I've never liked this advice. The part that's true is narrow: don't invent your own cryptographic primitives. Don't design your own hash function or cipher or signature scheme. Those are hard to get right, and the failure modes are subtle and catastrophic. Use the ones that exist.

But "don't implement auth" extends this further than it should. Implementing a system that uses well-understood primitives—calling `ecdsa.Verify` from the standard library—is not the same as inventing a new signature scheme. You do need to know what you're doing, but the [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) is public and quite straightforward to follow.

And the advice, taken broadly, discourages people from understanding how their systems actually work. You end up with developers who can integrate an auth library but couldn't tell you what it does, who trust the abstraction without knowing what's underneath. Which, frankly, is much riskier, in my opinion.

Understanding is worth a lot. When something breaks, when you need to debug a flow, when you're evaluating whether a library is doing the right thing—having implemented it yourself, even once, even just as a demo, gives you a foundation that reading docs doesn't - especially when the docs are as acronym-laden as these. WebAuthn is a good example: the protocol is simple enough that implementing it teaches you exactly what's happening, and there's no secret sauce in the libraries that you couldn't write yourself.
