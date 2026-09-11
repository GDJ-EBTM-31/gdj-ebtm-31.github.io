// Décode un QR code à partir d'une image, avec Core Image (fourni par macOS).
import Foundation
import CoreImage

guard CommandLine.arguments.count > 1,
      let image = CIImage(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])) else {
    print("IMAGE ILLISIBLE"); exit(1)
}
let detecteur = CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                           options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
let trouves = detecteur.features(in: image).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
if trouves.isEmpty { print("AUCUN QR DETECTE"); exit(1) }
trouves.forEach { print($0) }
