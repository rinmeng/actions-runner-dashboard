"use client"

import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

// Changed digits slide up when the value grows and down when it shrinks, blurring out as the
// new digit comes in from the other side. Everything else (".", ",", "%", " GB") stays put.
const digit = {
  enter: (direction: number) => ({ y: direction > 0 ? "100%" : "-100%", opacity: 0, filter: "blur(4px)" }),
  center: { y: "0%", opacity: 1, filter: "blur(0px)" },
  exit: (direction: number) => ({ y: direction > 0 ? "-100%" : "100%", opacity: 0, filter: "blur(4px)" }),
}

export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number
  format: (value: number) => string
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  // The last value and which way it moved, updated during render so the exiting and entering
  // digits agree on a direction (React's "storing information from previous renders").
  const [previous, setPrevious] = useState(value)
  const [direction, setDirection] = useState(1)
  if (value !== previous) {
    setDirection(value > previous ? 1 : -1)
    setPrevious(value)
  }

  const text = format(value)
  if (reduceMotion) return <span className={cn("tabular-nums", className)}>{text}</span>

  const chars = [...text]
  return (
    <span className={cn("relative inline-block tabular-nums", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          {chars.map((char, index) => {
            // Keyed from the right, so a digit keeps its key (and stays still) until it changes.
            const key = `${chars.length - index}:${char}`
            return /\d/.test(char) ? (
              <motion.span
                key={key}
                className="inline-block"
                custom={direction}
                variants={digit}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              >
                {char}
              </motion.span>
            ) : (
              <span key={key} className="whitespace-pre">
                {char}
              </span>
            )
          })}
        </AnimatePresence>
      </span>
    </span>
  )
}
