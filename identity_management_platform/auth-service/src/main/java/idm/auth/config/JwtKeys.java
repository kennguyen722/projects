package idm.auth.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;

@Configuration
public class JwtKeys {
  @Bean
  public KeyPair keyPair() {
    try {
      KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
      kpg.initialize(2048);
      return kpg.generateKeyPair();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("Unable to generate RSA key pair", e);
    }
  }

  public RSAPublicKey publicKey(KeyPair kp){ return (RSAPublicKey) kp.getPublic(); }
  public RSAPrivateKey privateKey(KeyPair kp){ return (RSAPrivateKey) kp.getPrivate(); }
}

@RestController
class JwksController {
  private final KeyPair keyPair;
  JwksController(KeyPair keyPair){ this.keyPair = keyPair; }

  @GetMapping("/oauth/jwks")
  public Object jwks(){
    var pub = (RSAPublicKey) keyPair.getPublic();
    byte[] nBytes = pub.getModulus().toByteArray();
    if(nBytes.length > 1 && nBytes[0] == 0){
      nBytes = java.util.Arrays.copyOfRange(nBytes, 1, nBytes.length);
    }
    byte[] eBytes = pub.getPublicExponent().toByteArray();
    if(eBytes.length > 1 && eBytes[0] == 0){
      eBytes = java.util.Arrays.copyOfRange(eBytes, 1, eBytes.length);
    }
    String n = b64(nBytes);
    String e = b64(eBytes);
    return java.util.Map.of("keys", java.util.List.of(java.util.Map.of(
        "kty","RSA",
        "alg","RS256",
        "use","sig",
        "kid","primary",
        "n", n,
        "e", e
    )));
  }

  private String b64(byte[] d){
    return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(d);
  }
}
