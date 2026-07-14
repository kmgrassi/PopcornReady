import { Link } from "react-router-dom";
import { PRICING } from "./homeContent";
import styles from "../HomePage.module.css";

export function LandingPricing() {
  return (
    <>
      <div className="lp-pricing">
        {PRICING.map((tier) => (
          <div
            className={`lp-price-card${tier.featured ? " featured" : ""}`}
            key={tier.name}
          >
            {tier.featured && <span className="lp-badge">Most popular</span>}
            <h3>{tier.name}</h3>
            <div className="lp-price">
              <span className="lp-price-amount">{tier.price}</span>
              <span className="lp-price-cadence">{tier.cadence}</span>
            </div>
            <p className="lp-price-blurb">{tier.blurb}</p>
            <ul className="lp-price-features">
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {tier.cta.external ? (
              <a
                className="lp-price-cta"
                href={tier.cta.href}
                target="_blank"
                rel="noreferrer"
              >
                {tier.cta.label}
              </a>
            ) : (
              <Link className="lp-price-cta" to={tier.cta.href}>
                {tier.cta.label}
              </Link>
            )}
          </div>
        ))}
      </div>
      <p className={styles.pricingNote}>
        1 credit = $0.01 of hosted generation. Self-hosting and bring-your-own-key
        generation do not spend credits.
      </p>
    </>
  );
}
