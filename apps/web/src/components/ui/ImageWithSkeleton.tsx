import {
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import styles from "./ImageWithSkeleton.module.css";

type ImageWithSkeletonProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fit?: "cover" | "contain";
  fill?: boolean;
  imageClassName?: string;
};

export function ImageWithSkeleton({
  src,
  fit = "cover",
  fill = false,
  className,
  imageClassName,
  onLoad,
  onError,
  ...props
}: ImageWithSkeletonProps) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    setLoaded(true);
    onLoad?.(event);
  }

  function handleError(event: SyntheticEvent<HTMLImageElement>) {
    onError?.(event);
  }

  return (
    <span
      className={`${styles.frame} ${loaded ? styles.loaded : ""} ${className ?? ""}`}
      data-fit={fit}
      data-fill={fill || undefined}
      aria-busy={!loaded}
    >
      <img
        {...props}
        className={`${styles.image} ${imageClassName ?? ""}`}
        src={src}
        onLoad={handleLoad}
        onError={handleError}
      />
    </span>
  );
}
