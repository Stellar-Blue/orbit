import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs resolves its own worker at runtime; bundling it rewrites that path to a chunk that does not
  // exist ("Setting up fake worker failed"), which broke every PDF read in the extraction route.
  serverExternalPackages: ['pdfjs-dist'],
};

export default nextConfig;
