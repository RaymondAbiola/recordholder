import type { NextConfig } from "next";

const config: NextConfig = {
  // The snapshots are read with fs at request time, which Next's tracer cannot infer,
  // so they have to be named explicitly or they are missing from the deployed bundle.
  outputFileTracingIncludes: {
    "/**": ["./data/*.json"],
  },
};

export default config;
