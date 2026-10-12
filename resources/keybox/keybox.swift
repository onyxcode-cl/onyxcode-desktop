// lazunox-keybox: guarda UNA llave de 32 bytes en el Llavero de inicio de sesión y se la entrega SOLO a Lazunox.
//
// POR QUÉ EXISTE: el Llavero de macOS reconoce a un programa sin Team ID de Apple por el hash EXACTO de su código (`cdhash`), que cambia
// en cada versión de Lazunox: cada actualización volvía a pedir la contraseña del Llavero. Este auxiliar es diminuto y NO cambia entre
// versiones (se compila una vez, de forma reproducible, ver build.sh), así que su `cdhash` es siempre el mismo y tras un único
// «Permitir siempre» el Llavero no vuelve a preguntar. Lazunox usa esa llave para cifrar el archivo de celulares vinculados.
//
// SEGURIDAD: antes de entregar la llave comprueba que quien lo lanzó (su proceso padre) es Lazunox: identificador `cl.bentec.lazunox`
// firmado con el MISMO certificado que este auxiliar. Un programa ajeno que lo ejecute recibe un rechazo, y uno que intente leer el
// elemento del Llavero directamente no está en su lista de particiones (macOS lo pregunta al usuario).
//
// CAMBIAR ESTE ARCHIVO CAMBIA SU IDENTIDAD: cada usuario verá la pregunta del Llavero una vez más. Hazlo solo si hace falta, recompila con
// build.sh y actualiza SOURCE.sha256 (lo exige una prueba).
import CommonCrypto
import Foundation
import Security

let keychainService = "Lazunox Keybox"
let keychainAccount = "remote-devices-v1"
let allowedIdentifier = "cl.bentec.lazunox"

func fail(_ code: Int32, _ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(code)
}

func sha1Hex(_ data: Data) -> String {
    var digest = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
    data.withUnsafeBytes { _ = CC_SHA1($0.baseAddress, CC_LONG(data.count), &digest) }
    return digest.map { String(format: "%02x", $0) }.joined()
}

/// SHA-1 del certificado con el que está firmado ESTE auxiliar (nil si es ad-hoc o no hay certificado).
func ownLeafCertificateHash() -> String? {
    var me: SecCode?
    guard SecCodeCopySelf([], &me) == errSecSuccess, let me = me else { return nil }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(me, [], &staticCode) == errSecSuccess, let staticCode = staticCode else { return nil }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let dict = info as? [String: Any],
          let certs = dict[kSecCodeInfoCertificates as String] as? [SecCertificate],
          let leaf = certs.first
    else { return nil }
    return sha1Hex(SecCertificateCopyData(leaf) as Data)
}

/// ¿El proceso que me lanzó es Lazunox, firmado con el mismo certificado que yo?
func callerIsLazunox() -> Bool {
    guard let leafHash = ownLeafCertificateHash() else { return false }
    var guest: SecCode?
    let attributes = [kSecGuestAttributePid as String: Int(getppid())] as CFDictionary
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &guest) == errSecSuccess, let guest = guest else { return false }
    let text = "identifier \"\(allowedIdentifier)\" and certificate leaf = H\"\(leafHash)\""
    var requirement: SecRequirement?
    guard SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess, let requirement = requirement else { return false }
    return SecCodeCheckValidity(guest, [], requirement) == errSecSuccess
}

func readKey() -> (status: OSStatus, key: Data?) {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: keychainAccount,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    return (status, out as? Data)
}

guard CommandLine.arguments.count == 2, CommandLine.arguments[1] == "key" else { fail(2, "uso: lazunox-keybox key") }
guard callerIsLazunox() else { fail(3, "rechazado: quien me lanzó no es Lazunox") }

var result = readKey()
if result.status == errSecItemNotFound {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { fail(4, "sin aleatorios") }
    let add: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: keychainAccount,
        kSecValueData as String: Data(bytes),
    ]
    let status = SecItemAdd(add as CFDictionary, nil)
    // Carrera con otro arranque que la creó antes: se vuelve a leer.
    if status == errSecSuccess || status == errSecDuplicateItem { result = readKey() } else { fail(5, "no se pudo guardar (\(status))") }
}
guard result.status == errSecSuccess, let key = result.key, key.count == 32 else { fail(6, "no se pudo leer (\(result.status))") }
print(key.base64EncodedString())
