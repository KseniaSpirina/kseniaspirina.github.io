import Foundation
import AVFoundation
import CoreVideo

// usage: rgba2hevc <out.mov> <width> <height> <fps> [quality]   (raw BGRA frames on stdin)
let a = CommandLine.arguments
guard a.count >= 5, let w = Int(a[2]), let h = Int(a[3]), let fps = Double(a[4]) else {
    FileHandle.standardError.write("usage\n".data(using: .utf8)!); exit(2)
}
let quality = a.count > 5 ? (Double(a[5]) ?? 0.75) : 0.75
let url = URL(fileURLWithPath: a[1])
try? FileManager.default.removeItem(at: url)
let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.hevcWithAlpha,
    AVVideoWidthKey: w,
    AVVideoHeightKey: h,
    AVVideoCompressionPropertiesKey: [AVVideoQualityKey: quality],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: w,
        kCVPixelBufferHeightKey as String: h,
    ])
writer.add(input)
guard writer.startWriting() else { print("startWriting failed: \(String(describing: writer.error))"); exit(1) }
writer.startSession(atSourceTime: .zero)

let frameBytes = w * h * 4
var index: Int64 = 0
let stdin = FileHandle.standardInput
while true {
    let data = stdin.readData(ofLength: frameBytes)
    if data.count < frameBytes { break }
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
    var pb: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool,
          CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb) == kCVReturnSuccess, let buf = pb else {
        print("no pixel buffer"); exit(1)
    }
    CVPixelBufferLockBaseAddress(buf, [])
    let base = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self)
    let bpr = CVPixelBufferGetBytesPerRow(buf)
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        let src = raw.bindMemory(to: UInt8.self)
        for y in 0..<h {
            let s = y * w * 4
            let d = y * bpr
            for x in 0..<w {
                let i = s + x * 4
                let al = Int(src[i + 3])
                // straight -> premultiplied alpha
                base[d + x * 4 + 0] = UInt8((Int(src[i + 0]) * al + 127) / 255)
                base[d + x * 4 + 1] = UInt8((Int(src[i + 1]) * al + 127) / 255)
                base[d + x * 4 + 2] = UInt8((Int(src[i + 2]) * al + 127) / 255)
                base[d + x * 4 + 3] = UInt8(al)
            }
        }
    }
    CVPixelBufferUnlockBaseAddress(buf, [])
    let t = CMTime(value: index * 1000, timescale: Int32((fps * 1000).rounded()))
    if !adaptor.append(buf, withPresentationTime: t) { print("append failed: \(String(describing: writer.error))"); exit(1) }
    index += 1
}
input.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
print("frames: \(index) status: \(writer.status.rawValue) err: \(String(describing: writer.error))")
