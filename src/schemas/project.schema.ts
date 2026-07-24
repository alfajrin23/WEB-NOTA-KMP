import { z } from "zod";

export const projectSchema = z.object({
  projectName: z.string().min(3, "Nama project wajib diisi"),
  wilayahType: z.enum(["desa", "kelurahan"]),
  villageName: z.string().min(2, "Nama desa / kelurahan wajib diisi"),
  districtName: z.string().min(2, "Kecamatan wajib diisi"),
  regencyName: z.string().min(2, "Kabupaten wajib diisi"),
  regionName: z.string().min(2, "Wilayah wajib diisi"),
  responsibleName: z.string().trim().min(2, "Nama Babinsa / Penanggung Jawab wajib diisi"),
  projectDate: z.string().min(1, "Tanggal awal project wajib diisi"),
});

export type ProjectFormValues = z.infer<typeof projectSchema>;
