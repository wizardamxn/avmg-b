import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Initialize the Supabase Matrix
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// The bucket is shared with other projects. Everything THIS project writes
// lives under this folder so uploads can't overwrite — and cleanup can't
// delete — files that belong to the other projects.
export const STORAGE_PREFIX = "avmg/";

export const transmitToCloud = async (localFilePath, fileName) => {
  console.log(`> [SUPABASE_UPLINK] Beaming ${fileName} to free orbital grid...`);

  // Read the local file into memory
  const fileBuffer = fs.readFileSync(localFilePath);

  // Confine the object to this project's folder inside the shared bucket.
  const storageKey = STORAGE_PREFIX + fileName;

  // 1. Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('avmg-payloads')
    .upload(storageKey, fileBuffer, {
      upsert: true, // Overwrite if a file with the same name exists
    });

  if (error) {
    console.error("> [SUPABASE_ERR] Transmission failed:", error.message);
    throw error;
  }

  // 2. Get the permanent Public URL for the user to download
  const { data: publicUrlData } = supabase.storage
    .from('avmg-payloads')
    .getPublicUrl(storageKey);
  
  // 3. Vaporize the local file immediately to protect server storage
  fs.unlinkSync(localFilePath);
  console.log(`> [SUPABASE_UPLINK] Payload secured. Local evidence destroyed.`);
  
  return publicUrlData.publicUrl;
};