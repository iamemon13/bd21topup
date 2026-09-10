"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const banners = [
  "/banners/banner-1.png",
  "/banners/banner-2.png",
  "/banners/banner-3.png",
  "/banners/banner-4.jpg",
  "/banners/banner-5.png",
];
export default function BannerSlider() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % banners.length);
    }, 4000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <div className="relative aspect-[3/1] overflow-hidden rounded-2xl border border-cyan-400/20">
        {banners.map((banner, index) => (
          <Image
            key={banner}
            src={banner}
            alt={`BD21 Banner ${index + 1}`}
            fill
            priority={index === 0}
            sizes="100vw"
            className={`object-cover transition-opacity duration-700 ${
              current === index ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>

      <div className="mt-3 flex justify-center gap-2">
        {banners.map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setCurrent(index)}
            className={`h-2 rounded-full transition-all ${
              current === index
                ? "w-7 bg-cyan-400"
                : "w-2 bg-slate-500"
            }`}
            aria-label={`Banner ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}