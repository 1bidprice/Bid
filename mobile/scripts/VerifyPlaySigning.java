import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.CodeSigner;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Locale;
import java.util.jar.JarFile;

/** Java 17 source launcher. Verifies signing only; bundletool/Play checks remain separate. */
public class VerifyPlaySigning {
    private static final String LEGACY_DEBUG_SHA256 =
        "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c";

    private static String fingerprint(X509Certificate certificate) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded()));
    }

    private static String expectedFingerprint(String value) {
        String normalized = value.replace(":", "").replaceAll("\\s", "").toLowerCase(Locale.ROOT);
        if (!normalized.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("EXPECTED_CERTIFICATE_SHA256_INVALID");
        return normalized;
    }

    private static void verifyCertificate(X509Certificate certificate, String expected) throws Exception {
        certificate.checkValidity();
        String actual = fingerprint(certificate);
        if (actual.equals(LEGACY_DEBUG_SHA256)
                || certificate.getSubjectX500Principal().getName().toLowerCase(Locale.ROOT).contains("android debug")) {
            throw new SecurityException("DEBUG_CERTIFICATE_REJECTED");
        }
        if (!(certificate.getPublicKey() instanceof RSAPublicKey key) || key.getModulus().bitLength() < 2048) {
            throw new SecurityException("UPLOAD_KEY_REQUIRES_RSA_2048_OR_STRONGER");
        }
        String algorithm = certificate.getSigAlgName().toUpperCase(Locale.ROOT);
        if (algorithm.contains("MD5") || algorithm.contains("SHA1")) throw new SecurityException("WEAK_CERTIFICATE_ALGORITHM");
        if (!actual.equals(expected)) throw new SecurityException("UPLOAD_CERTIFICATE_SHA256_MISMATCH");
    }

    private static boolean signingMetadata(String name) {
        return name.toUpperCase(Locale.ROOT).matches("META-INF/(MANIFEST\\.MF|[^/]+\\.(SF|RSA|DSA|EC))");
    }

    public static void main(String[] args) {
        try {
            if (args.length != 4 || !args[2].equals("--expected-sha256")) {
                throw new IllegalArgumentException("Usage: VerifyPlaySigning.java --certificate PEM|--bundle AAB --expected-sha256 SHA256");
            }
            String expected = expectedFingerprint(args[3]);
            Path input = Path.of(args[1]);
            if (args[0].equals("--certificate")) {
                try (InputStream stream = Files.newInputStream(input)) {
                    X509Certificate certificate = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(stream);
                    verifyCertificate(certificate, expected);
                    System.out.println("{\"status\":\"PASS\",\"scope\":\"upload-certificate\",\"certificateSha256\":\"" + expected + "\"}");
                }
            } else if (args[0].equals("--bundle")) {
                int payloadEntries = 0;
                HashSet<String> names = new HashSet<>();
                try (JarFile jar = new JarFile(input.toFile(), true)) {
                    var entries = jar.entries();
                    byte[] buffer = new byte[65536];
                    while (entries.hasMoreElements()) {
                        var entry = entries.nextElement();
                        if (!names.add(entry.getName())) throw new SecurityException("DUPLICATE_BUNDLE_ENTRY");
                        if (entry.isDirectory()) continue;
                        // Reading every byte invokes the JDK's manifest digest and signature verification.
                        try (InputStream stream = jar.getInputStream(entry)) { while (stream.read(buffer) != -1) {} }
                        if (signingMetadata(entry.getName())) continue;
                        CodeSigner[] signers = entry.getCodeSigners();
                        if (signers == null || signers.length != 1) throw new SecurityException("UNSIGNED_OR_MULTIPLE_SIGNER_ENTRY");
                        X509Certificate leaf = (X509Certificate) signers[0].getSignerCertPath().getCertificates().get(0);
                        verifyCertificate(leaf, expected);
                        payloadEntries++;
                    }
                }
                if (payloadEntries == 0) throw new SecurityException("EMPTY_SIGNED_PAYLOAD");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream stream = Files.newInputStream(input)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = stream.read(buffer)) != -1) digest.update(buffer, 0, count);
                }
                System.out.println("{\"status\":\"PASS\",\"scope\":\"bundle-signature-only\",\"certificateSha256\":\""
                    + expected + "\",\"payloadEntries\":" + payloadEntries + ",\"bundleSha256\":\""
                    + HexFormat.of().formatHex(digest.digest()) + "\"}");
            } else throw new IllegalArgumentException("UNKNOWN_VERIFICATION_MODE");
        } catch (Exception error) {
            System.err.println("PLAY_SIGNING_VERIFICATION_FAILED: " + error.getClass().getSimpleName() + ": " + error.getMessage());
            System.exit(1);
        }
    }
}
