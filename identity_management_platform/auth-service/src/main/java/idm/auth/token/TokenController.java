package idm.auth.token;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.NoOpPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.Base64;
import java.security.KeyPair;
import java.security.Signature;
import java.security.interfaces.RSAPrivateKey;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.UUID;

@RestController
@RequestMapping("/oauth")
public class TokenController {

  @Autowired
  StringRedisTemplate redis;

  // Fallback in-memory refresh store when Redis is unavailable (dev-only)
  private static final Map<String, RefreshEntry> memRefresh = new ConcurrentHashMap<>();
  private record RefreshEntry(String username, long expiresAt) {}

  // DEMO user/password
  private boolean validateUser(String username, String password){
    return "demo".equals(username) && "demo".equals(password);
  }

  @PostMapping("/token")
  public ResponseEntity<?> token(@RequestParam("grant_type") String grant_type,
                                 @RequestParam(value="username", required=false) String username,
                                 @RequestParam(value="password", required=false) String password){
    if(!"password".equals(grant_type)) { return ResponseEntity.badRequest().body(Map.of("error","unsupported_grant")); }
    if(!validateUser(username,password)) return ResponseEntity.status(401).body(Map.of("error","invalid_credentials"));
    String access = jwtFor(username,5*60); // 5 min
    String refresh = UUID.randomUUID().toString();
    storeRefresh(refresh, username, Duration.ofHours(1));
    return ResponseEntity.ok(Map.of("access_token", access, "token_type","Bearer", "expires_in",300, "refresh_token", refresh, "scope","scim.read scim.write"));
  }

  @PostMapping("/refresh")
  public ResponseEntity<?> refresh(@RequestParam("refresh_token") String refresh_token){
    String username = consumeRefresh(refresh_token);
    if(username==null) return ResponseEntity.status(401).body(Map.of("error","invalid_refresh"));
    String newRefresh = UUID.randomUUID().toString();
    storeRefresh(newRefresh, username, Duration.ofHours(1));
    String access = jwtFor(username,5*60);
    return ResponseEntity.ok(Map.of("access_token", access, "token_type","Bearer", "expires_in",300, "refresh_token", newRefresh, "scope","scim.read scim.write"));
  }

  private void storeRefresh(String token, String username, Duration ttl){
    try {
      redis.opsForValue().set(refreshKey(token), username, ttl);
    } catch (Exception e){
      long exp = System.currentTimeMillis() + ttl.toMillis();
      memRefresh.put(token, new RefreshEntry(username, exp));
    }
  }

  private String consumeRefresh(String token){
    // Try Redis first
    try {
      String u = redis.opsForValue().get(refreshKey(token));
      if(u!=null){
        try { redis.delete(refreshKey(token)); } catch (Exception ignore) {}
        return u;
      }
    } catch (Exception ignore){ }
    // Fallback to memory
    RefreshEntry e = memRefresh.remove(token);
    if(e==null) return null;
    if(e.expiresAt() < System.currentTimeMillis()) return null;
    return e.username();
  }

  private String refreshKey(String r){ return "refresh:"+r; }

  // Simplified unsigned placeholder (replace with proper signing) for brevity
  @Autowired
  KeyPair keyPair;

  private String jwtFor(String sub, long expSeconds){
    try {
      long now = System.currentTimeMillis()/1000;
      String headerJson = "{\"alg\":\"RS256\",\"typ\":\"JWT\",\"kid\":\"primary\"}";
      String payloadJson = String.format("{\"iss\":\"auth-service\",\"sub\":\"%s\",\"scope\":\"scim.read scim.write\",\"iat\":%d,\"exp\":%d}", sub, now, now+expSeconds);
      String header = b64(headerJson.getBytes(StandardCharsets.UTF_8));
      String payload = b64(payloadJson.getBytes(StandardCharsets.UTF_8));
      String signingInput = header+"."+payload;
      Signature sig = Signature.getInstance("SHA256withRSA");
      sig.initSign((RSAPrivateKey) keyPair.getPrivate());
      sig.update(signingInput.getBytes(StandardCharsets.UTF_8));
      String signature = b64(sig.sign());
      return signingInput+"."+signature;
    } catch (Exception e){ throw new IllegalStateException("JWT signing failed", e); }
  }

  private String b64(byte[] data){
    return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
  }
}
