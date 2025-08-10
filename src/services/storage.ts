export const storage = {
  async saveVoiceSample(userId: number, buffer: Buffer, filename: string): Promise<string> {
    // TODO: подключить реальный S3. Пока возвращаем фейковый URL.
    return `s3://fake-bucket/${userId}/${filename}`;
  },
};
