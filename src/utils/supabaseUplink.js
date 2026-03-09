import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Initialize the Supabase Matrix
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const transmitToCloud = async (localFilePath, fileName) => {
  console.log(`> [SUPABASE_UPLINK] Beaming ${fileName} to free orbital grid...`);
  
  // Read the local file into memory
  const fileBuffer = fs.readFileSync(localFilePath);
  
  // 1. Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('avmg-payloads')
    .upload(fileName, fileBuffer, {
      upsert: true, // Overwrite if a file with the same name exists
    });

  if (error) {
    console.error("> [SUPABASE_ERR] Transmission failed:", error.message);
    throw error;
  }

  // 2. Get the permanent Public URL for the user to download
  const { data: publicUrlData } = supabase.storage
    .from('avmg-payloads')
    .getPublicUrl(fileName);
  
  // 3. Vaporize the local file immediately to protect server storage
  fs.unlinkSync(localFilePath);
  console.log(`> [SUPABASE_UPLINK] Payload secured. Local evidence destroyed.`);
  
  return publicUrlData.publicUrl;
};