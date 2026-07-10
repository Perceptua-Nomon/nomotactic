module.exports = {
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  },
  RecordingPresets: {
    HIGH_QUALITY: { extension: ".m4a" },
    LOW_QUALITY: { extension: ".m4a" },
  },
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioRecorder: jest.fn(),
};
